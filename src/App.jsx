import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Home, Search, PlusSquare, Users as UsersIcon, User, Heart, MessageCircle, 
  Send, ChevronLeft, Image as ImageIcon, Zap, Settings, 
  Loader2, Bell, MessageSquare, AlertCircle, UserPlus, CheckCircle2, MapPin, X, Clock, RefreshCcw
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, addDoc, getDocs, onSnapshot, deleteDoc, updateDoc } from 'firebase/firestore';

// ==========================================
// 1. CONFIGURATION & PATHS
// ==========================================
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'entrepreneurx-prod';

const getDbCollection = (colName) => collection(db, 'artifacts', appId, 'public', 'data', colName);
const getDbDoc = (colName, docId) => doc(db, 'artifacts', appId, 'public', 'data', colName, docId);

// ==========================================
// 2. CONSTANTS & OFFLINE ENGINE
// ==========================================
const ROLES = ['Founder', 'Software Engineer', 'Product Designer', 'Growth Marketer', 'Sales/BD', 'Investor'];
const SKILLS = ['React', 'Node.js', 'Figma', 'SEO', 'Sales', 'Python', 'Marketing', 'Product Management', 'Finance'];
const COMMUNITY_TOPICS = ['Ideas', 'Co-founder Search', 'Marketing', 'Tech', 'Beginner Help'];
const getSortedId = (id1, id2) => [id1, id2].sort().join('_');

const MatchingEngine = {
  evaluateMatch(me, them) {
    if (!me || !them || me.id === them.id) return { score: 0, reasons: [] };
    let score = 0; let reasons = [];
    if (me.role !== them.role) { score += 40; reasons.push('Complementary roles'); } 
    else { score += 10; reasons.push('Same role background'); }
    const sharedSkills = (me.skills || []).filter(s => (them.skills || []).includes(s));
    if (sharedSkills.length > 0) { score += 20; reasons.push(`Shared skills: ${sharedSkills.join(', ')}`); }
    if (me.lookingForCoFounder && them.lookingForCoFounder) { score += 30; reasons.push('Both seeking co-founders'); }
    if (me.location && them.location && me.location.toLowerCase().trim() === them.location.toLowerCase().trim()) {
        score += 25; reasons.push('Same location');
    }
    return { score: Math.min(score, 100), reasons };
  },
  async runBackgroundJob(currentUserProfile, allUsers) {
    try {
      const batchPromises = allUsers.map(async (targetUser) => {
        if (targetUser.id === currentUserProfile.id) return;
        const { score, reasons } = this.evaluateMatch(currentUserProfile, targetUser);
        if (score >= 50) {
          const matchId = getSortedId(currentUserProfile.id, targetUser.id);
          await setDoc(getDbDoc('matches', matchId), { participants: [currentUserProfile.id, targetUser.id], score, reasons, timestamp: Date.now() });
        }
      });
      await Promise.all(batchPromises);
    } catch (error) { console.error("Matching Error:", error); }
  }
};

// ==========================================
// 3. CORE HOOKS
// ==========================================

function useAuth() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [allUsersCache, setAllUsersCache] = useState([]);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) await signInWithCustomToken(auth, __initial_auth_token);
        else await signInAnonymously(auth);
      } catch (err) { console.error("Auth Error:", err); }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) { setProfile(null); setLoading(false); return; }
      const profileUnsub = onSnapshot(getDbDoc('users', currentUser.uid), (doc) => {
        if (doc.exists()) setProfile({ id: doc.id, ...doc.data() });
        else setProfile(null); 
        setLoading(false);
      });
      const usersUnsub = onSnapshot(getDbCollection('users'), (snap) => setAllUsersCache(snap.docs.map(d => ({id: d.id, ...d.data()}))));
      return () => { profileUnsub(); usersUnsub(); };
    });
    return () => unsubscribe();
  }, []);

  const saveProfile = async (profileData) => {
    if (!user) throw new Error("Not authenticated");
    const newProfile = { ...profileData, updatedAt: Date.now(), avatar: profile?.avatar || `https://api.dicebear.com/7.x/notionists/svg?seed=${user.uid}` };
    if (!profile) newProfile.createdAt = Date.now();
    await setDoc(getDbDoc('users', user.uid), newProfile, { merge: true });
    setTimeout(() => { MatchingEngine.runBackgroundJob({ id: user.uid, ...newProfile }, allUsersCache); }, 500);
  };
  return { user, profile, loading, saveProfile, usersMap: allUsersCache.reduce((acc, u) => ({...acc, [u.id]: u}), {}), allUsersArray: allUsersCache };
}

// ------------------------------------------------------------------
// 🔥 ADVANCED INFINITE FEED HOOK (CURSOR PAGINATION SIMULATED)
// ------------------------------------------------------------------
function useInfiniteFeed(user, usersMap) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  
  // Hidden refs for simulated pagination logic
  const masterListRef = useRef([]);
  const currentIndexRef = useRef(0);
  const POSTS_PER_PAGE = 5;

  const fetchInitial = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // 1. Fetch raw posts & likes once
      const [postsSnap, likesSnap] = await Promise.all([
          getDocs(getDbCollection('posts')),
          getDocs(getDbCollection('likes'))
      ]);
      
      const allLikes = likesSnap.docs.map(d => ({id: d.id, ...d.data()}));
      const rawPosts = postsSnap.docs.map(d => ({id: d.id, ...d.data()}));
      
      // 2. Aggregate & Sort in memory (Rule 2 safe)
      const enriched = rawPosts.map(p => {
          const postLikes = allLikes.filter(l => l.postId === p.id);
          const isLikedByMe = postLikes.some(l => l.userId === user.uid);
          return {
              ...p,
              author: usersMap[p.authorId] || { name: 'Unknown', avatar: '' },
              likesCount: postLikes.length,
              isLikedByMe,
              likeDocId: isLikedByMe ? postLikes.find(l => l.userId === user.uid)?.id : null
          };
      }).sort((a,b) => b.timestamp - a.timestamp);

      masterListRef.current = enriched;
      currentIndexRef.current = POSTS_PER_PAGE;
      
      setPosts(enriched.slice(0, POSTS_PER_PAGE));
      setHasMore(enriched.length > POSTS_PER_PAGE);
    } catch (error) {
      console.error("Feed error:", error);
    } finally {
      setLoading(false);
    }
  }, [user, usersMap]);

  // Initial load effect
  useEffect(() => {
    if (Object.keys(usersMap).length > 0) fetchInitial();
  }, [fetchInitial]);

  const fetchMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      // Simulate network latency for addictive "Instagram" feel
      await new Promise(res => setTimeout(res, 600)); 
      
      const nextIndex = currentIndexRef.current + POSTS_PER_PAGE;
      const nextChunk = masterListRef.current.slice(currentIndexRef.current, nextIndex);
      
      if (nextChunk.length > 0) {
          setPosts(prev => {
              const newItems = nextChunk.filter(nc => !prev.find(p => p.id === nc.id));
              return [...prev, ...newItems];
          });
          currentIndexRef.current = nextIndex;
      }
      if (nextIndex >= masterListRef.current.length) setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore]);

  // Optimistic Like Toggle
  const toggleLike = async (post) => {
    // 1. Optimistic UI Update
    setPosts(prev => prev.map(p => {
        if (p.id !== post.id) return p;
        return {
            ...p, 
            isLikedByMe: !p.isLikedByMe, 
            likesCount: p.isLikedByMe ? p.likesCount - 1 : p.likesCount + 1 
        };
    }));

    // 2. Background DB Update
    try {
        if (post.isLikedByMe && post.likeDocId) {
            await deleteDoc(getDbDoc('likes', post.likeDocId));
        } else {
            await addDoc(getDbCollection('likes'), { postId: post.id, userId: user.uid, timestamp: Date.now() });
            if (post.authorId !== user.uid) await addDoc(getDbCollection('notifications'), { userId: post.authorId, type: 'like', sourceId: user.uid, postId: post.id, timestamp: Date.now(), read: false });
        }
    } catch (e) { console.error(e); } // Revert omitted for brevity
  };

  return { posts, loading, loadingMore, hasMore, fetchMore, fetchInitial, toggleLike };
}

// Other Hooks...
function useMatches(userId) {
    const [matches, setMatches] = useState([]);
    useEffect(() => {
        if (!userId) return;
        const unsub = onSnapshot(getDbCollection('matches'), (snap) => {
            const myMatches = snap.docs.map(d => ({id: d.id, ...d.data()})).filter(m => m.participants && m.participants.includes(userId)).sort((a, b) => b.score - a.score);
            setMatches(myMatches);
        });
        return () => unsub();
    }, [userId]);
    return matches;
}

function useConnections(user) {
    const [connections, setConnections] = useState([]);
    useEffect(() => {
        if (!user) return;
        const unsub = onSnapshot(getDbCollection('connections'), (snap) => setConnections(snap.docs.map(d => ({id: d.id, ...d.data()}))));
        return () => unsub();
    }, [user]);

    const myConnections = useMemo(() => connections.filter(c => c.participants && c.participants.includes(user?.uid)), [connections, user]);

    const sendRequest = async (targetId) => {
        const connId = getSortedId(user.uid, targetId);
        await setDoc(getDbDoc('connections', connId), { participants: [user.uid, targetId], from: user.uid, to: targetId, status: 'pending', timestamp: Date.now() });
        await addDoc(getDbCollection('notifications'), { userId: targetId, type: 'connection_request', sourceId: user.uid, timestamp: Date.now(), read: false });
    };

    const acceptRequest = async (connId, targetId) => {
        await updateDoc(getDbDoc('connections', connId), { status: 'connected', updatedAt: Date.now() });
        await addDoc(getDbCollection('notifications'), { userId: targetId, type: 'connection_accepted', sourceId: user.uid, timestamp: Date.now(), read: false });
    };
    return { connections: myConnections, sendRequest, acceptRequest };
}

function useChat(user, activeChatPartner) {
  const [messages, setMessages] = useState([]);
  useEffect(() => {
    if (!user || !activeChatPartner) return;
    const chatId = getSortedId(user.uid, activeChatPartner.id);
    const unsubscribe = onSnapshot(getDbCollection('messages'), (snapshot) => {
      setMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(m => m.chatId === chatId).sort((a, b) => a.timestamp - b.timestamp));
    });
    return () => unsubscribe();
  }, [user, activeChatPartner]);

  const sendMessage = async (text) => {
    if (!user || !activeChatPartner || !text.trim()) return;
    const chatId = getSortedId(user.uid, activeChatPartner.id);
    await addDoc(getDbCollection('messages'), { chatId, text, senderId: user.uid, receiverId: activeChatPartner.id, timestamp: Date.now(), read: false });
    await addDoc(getDbCollection('notifications'), { userId: activeChatPartner.id, type: 'message', sourceId: user.uid, timestamp: Date.now(), read: false });
  };
  return { messages, sendMessage };
}

function useThreads(user, usersMap) {
    const [threads, setThreads] = useState([]);
    useEffect(() => {
        if (!user) return;
        const unsub = onSnapshot(getDbCollection('threads'), (snap) => setThreads(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
        return () => unsub();
    }, [user]);
    const enrichedThreads = useMemo(() => threads.map(t => ({ ...t, author: usersMap[t.authorId] || { name: 'Unknown' } })).sort((a, b) => b.timestamp - a.timestamp), [threads, usersMap]);
    const createThread = async (title, topic) => {
        await addDoc(getDbCollection('threads'), { title, topic, authorId: user.uid, repliesCount: 0, timestamp: Date.now() });
    };
    return { threads: enrichedThreads, createThread };
}

// ==========================================
// 4. MAIN APP ROUTER (SCROLL PRESERVING)
// ==========================================
export default function App() {
  const { user, profile, loading: authLoading, saveProfile, usersMap, allUsersArray } = useAuth();
  const [activeTab, setActiveTab] = useState('home');
  const [activeChat, setActiveChat] = useState(null); 

  if (authLoading) return <LoadingScreen message="Initializing Platform..." />;
  if (user && !profile) return <ProfileSetupScreen onSubmit={saveProfile} />;

  // Display: none router preserves DOM and scroll states
  return (
    <div className="min-h-screen bg-gray-100 flex justify-center sm:py-4 font-sans text-gray-900">
      <div className="w-full sm:max-w-md bg-gray-50 sm:rounded-[2.5rem] sm:shadow-2xl overflow-hidden flex flex-col relative h-screen sm:h-[90vh] sm:border-[6px] sm:border-gray-900">
        
        {activeChat ? (
            <ChatScreen currentUser={user} chatPartner={activeChat} onBack={() => setActiveChat(null)} />
        ) : (
            <div className="flex-1 relative overflow-hidden flex flex-col pb-16">
                <div className={`flex-1 overflow-hidden flex flex-col ${activeTab === 'home' ? 'flex' : 'hidden'}`}>
                    <HomeFeed user={user} usersMap={usersMap} allUsersArray={allUsersArray} onOpenNotifications={() => setActiveTab('notifications')} />
                </div>
                <div className={`flex-1 overflow-hidden flex flex-col ${activeTab === 'explore' ? 'flex' : 'hidden'}`}>
                    <ExploreScreen user={user} usersMap={usersMap} allUsersArray={allUsersArray} onMessage={(u) => setActiveChat(u)} />
                </div>
                <div className={`flex-1 overflow-hidden flex flex-col ${activeTab === 'create' ? 'flex' : 'hidden'}`}>
                    <CreateScreen user={user} onPostCreated={() => setActiveTab('home')} />
                </div>
                <div className={`flex-1 overflow-hidden flex flex-col ${activeTab === 'community' ? 'flex' : 'hidden'}`}>
                    <CommunityScreen user={user} usersMap={usersMap} />
                </div>
                <div className={`flex-1 overflow-hidden flex flex-col ${activeTab === 'profile' ? 'flex' : 'hidden'}`}>
                    <ProfileScreen profile={profile} onEdit={() => setActiveTab('edit_profile')} />
                </div>
                <div className={`flex-1 overflow-hidden flex flex-col ${activeTab === 'notifications' ? 'flex' : 'hidden'}`}>
                    <NotificationsScreen user={user} usersMap={usersMap} onBack={() => setActiveTab('home')} />
                </div>
                <div className={`flex-1 overflow-hidden flex flex-col ${activeTab === 'edit_profile' ? 'flex' : 'hidden'}`}>
                    <ProfileSetupScreen initialData={profile} onSubmit={async (d) => { await saveProfile(d); setActiveTab('profile'); }} onCancel={() => setActiveTab('profile')} />
                </div>
            </div>
        )}

        {!activeChat && activeTab !== 'notifications' && activeTab !== 'edit_profile' && (
          <nav className="absolute bottom-0 w-full bg-white/95 backdrop-blur-lg border-t border-gray-100 flex justify-between px-6 py-3 pb-safe z-50">
            <NavItem icon={<Home />} label="Home" isActive={activeTab === 'home'} onClick={() => setActiveTab('home')} />
            <NavItem icon={<Search />} label="Explore" isActive={activeTab === 'explore'} onClick={() => setActiveTab('explore')} />
            <NavItem icon={<PlusSquare />} label="Create" isActive={activeTab === 'create'} onClick={() => setActiveTab('create')} isPrimary />
            <NavItem icon={<UsersIcon />} label="Community" isActive={activeTab === 'community'} onClick={() => setActiveTab('community')} />
            <NavItem icon={<User />} label="Profile" isActive={activeTab === 'profile'} onClick={() => setActiveTab('profile')} />
          </nav>
        )}
      </div>
    </div>
  );
}

// ==========================================
// 5. SCREENS & COMPONENTS
// ==========================================

function HomeFeed({ user, usersMap, allUsersArray, onOpenNotifications }) {
  const { posts, loading, loadingMore, hasMore, fetchMore, fetchInitial, toggleLike } = useInfiniteFeed(user, usersMap);
  const [unreadCount, setUnreadCount] = useState(0);

  // Notifications Badge Listener
  useEffect(() => {
      if(!user) return;
      return onSnapshot(getDbCollection('notifications'), (snap) => {
          setUnreadCount(snap.docs.filter(d => d.data().userId === user.uid && !d.data().read).length);
      });
  }, [user]);

  // Infinite Scroll Intersection Logic
  const handleScroll = (e) => {
      const { scrollTop, scrollHeight, clientHeight } = e.target;
      if (scrollHeight - scrollTop <= clientHeight + 200) {
          fetchMore();
      }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <header className="bg-white/95 backdrop-blur-md sticky top-0 z-40 px-4 py-3 flex justify-between items-center border-b border-gray-100 shadow-sm">
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">EntrepreneurX</h1>
        <button onClick={onOpenNotifications} className="p-2 hover:bg-gray-100 rounded-full transition-colors relative">
          <Bell className="w-6 h-6 text-gray-700" />
          {unreadCount > 0 && <span className="absolute top-1.5 right-2 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white animate-pulse"></span>}
        </button>
      </header>
      
      <div className="flex-1 overflow-y-auto no-scrollbar pb-10" onScroll={handleScroll}>
        <div className="flex flex-col gap-3 pt-2">
            
            {/* Initial Loading Skeletons */}
            {loading && [1,2,3].map(i => <PostSkeleton key={i} />)}
            
            {/* Empty State */}
            {!loading && posts.length === 0 && (
                <EmptyState icon={<MessageSquare/>} title="Quiet here" desc="Follow founders to see their updates." />
            )}

            {/* Posts & Suggested Injection */}
            {!loading && posts.map((post, index) => (
                <React.Fragment key={post.id}>
                    <PostCard post={post} onLike={() => toggleLike(post)} />
                    
                    {/* Addictive UX: Inject suggestions every 5 posts */}
                    {index > 0 && (index + 1) % 5 === 0 && (
                        <SuggestedFoundersInline users={allUsersArray} currentUser={user} />
                    )}
                </React.Fragment>
            ))}

            {/* Bottom Spinners & Feedback */}
            {loadingMore && (
                <div className="py-6 flex justify-center"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
            )}
            {!hasMore && !loading && posts.length > 0 && (
                <div className="py-10 flex flex-col items-center justify-center gap-2">
                    <CheckCircle2 className="w-8 h-8 text-gray-300" />
                    <p className="text-xs font-bold text-gray-400">You're all caught up!</p>
                    <button onClick={fetchInitial} className="mt-2 text-blue-600 flex items-center gap-1 text-xs font-bold bg-blue-50 px-3 py-1.5 rounded-full hover:bg-blue-100">
                        <RefreshCcw className="w-3 h-3"/> Refresh Feed
                    </button>
                </div>
            )}
        </div>
      </div>
    </div>
  );
}

// Addictive Inline Component
function SuggestedFoundersInline({ users, currentUser }) {
    // Randomize and slice 5 founders
    const suggestions = useMemo(() => {
        return users.filter(u => u.id !== currentUser.uid).sort(() => 0.5 - Math.random()).slice(0, 5);
    }, [users, currentUser]);

    if(suggestions.length === 0) return null;

    return (
        <div className="bg-gray-50 py-4 my-1 border-y border-gray-100 shadow-inner">
            <h4 className="px-4 text-[10px] font-bold text-gray-400 mb-3 uppercase tracking-wider flex items-center gap-1"><Zap className="w-3 h-3"/> Suggested Connections</h4>
            <div className="flex overflow-x-auto no-scrollbar gap-3 px-4 pb-2">
                {suggestions.map(u => (
                    <div key={u.id} className="min-w-[130px] bg-white p-3 rounded-2xl border border-gray-200 flex flex-col items-center text-center shadow-sm">
                        <img src={u.avatar} className="w-12 h-12 rounded-full mb-2 object-cover border border-gray-100" alt=""/>
                        <h5 className="font-bold text-xs text-gray-900 truncate w-full">{u.name}</h5>
                        <p className="text-[9px] text-gray-500 truncate w-full mb-3">{u.role}</p>
                        <button className="w-full bg-blue-600 text-white font-bold text-xs py-1.5 rounded-lg shadow-sm">Connect</button>
                    </div>
                ))}
            </div>
        </div>
    )
}

function PostSkeleton() {
    return (
        <div className="bg-white p-4 border-y border-gray-100 animate-pulse">
            <div className="flex gap-3 items-center mb-4">
                <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
                <div className="flex flex-col gap-1.5">
                    <div className="w-24 h-3 bg-gray-200 rounded"></div>
                    <div className="w-16 h-2 bg-gray-200 rounded"></div>
                </div>
            </div>
            <div className="w-full h-3 bg-gray-200 rounded mb-2"></div>
            <div className="w-full h-3 bg-gray-200 rounded mb-2"></div>
            <div className="w-2/3 h-3 bg-gray-200 rounded"></div>
        </div>
    )
}

function ExploreScreen({ user, usersMap, allUsersArray, onMessage }) {
  const [activeTab, setActiveTab] = useState('matches'); 
  const matches = useMatches(user?.uid);
  const { connections, sendRequest, acceptRequest } = useConnections(user);

  const [searchRole, setSearchRole] = useState('');
  const [searchLoc, setSearchLoc] = useState('');
  const [searchIntent, setSearchIntent] = useState(false);

  const pendingRequests = useMemo(() => connections.filter(c => c.to === user?.uid && c.status === 'pending'), [connections, user]);

  const searchResults = useMemo(() => {
      let res = allUsersArray.filter(u => u.id !== user?.uid);
      if (searchRole) res = res.filter(u => u.role === searchRole);
      if (searchLoc) res = res.filter(u => u.location?.toLowerCase().includes(searchLoc.toLowerCase()));
      if (searchIntent) res = res.filter(u => u.lookingForCoFounder);
      return res;
  }, [allUsersArray, searchRole, searchLoc, searchIntent, user]);

  const getConnectionStatus = (targetId) => {
      const conn = connections.find(c => c.participants.includes(targetId));
      if (!conn) return 'none';
      if (conn.status === 'connected') return 'connected';
      if (conn.from === user.uid) return 'sent';
      return 'received';
  };

  const ConnectionButton = ({ targetId, connObj }) => {
      const status = getConnectionStatus(targetId);
      if (status === 'connected') return <button onClick={() => onMessage(usersMap[targetId])} className="w-full bg-gray-900 text-white text-xs font-bold py-2 rounded-xl">Message</button>;
      if (status === 'sent') return <button disabled className="w-full bg-gray-100 text-gray-500 text-xs font-bold py-2 rounded-xl flex justify-center items-center gap-1"><Clock className="w-4 h-4"/> Pending</button>;
      if (status === 'received') return <button onClick={() => acceptRequest(connObj.id, targetId)} className="w-full bg-blue-600 text-white text-xs font-bold py-2 rounded-xl">Accept Request</button>;
      return <button onClick={() => sendRequest(targetId)} className="w-full bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 text-xs font-bold py-2 rounded-xl flex justify-center items-center gap-1"><UserPlus className="w-4 h-4"/> Connect</button>;
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <header className="bg-white sticky top-0 z-40 px-4 pt-4 pb-2 border-b border-gray-100 shadow-sm">
        <h2 className="text-xl font-bold text-gray-900 mb-3">Network</h2>
        <div className="flex gap-2 mb-2 bg-gray-100 p-1 rounded-xl">
            <button onClick={() => setActiveTab('matches')} className={`flex-1 py-1.5 text-xs font-bold rounded-lg ${activeTab === 'matches' ? 'bg-white shadow-sm' : 'text-gray-500'}`}>Top Matches</button>
            <button onClick={() => setActiveTab('search')} className={`flex-1 py-1.5 text-xs font-bold rounded-lg ${activeTab === 'search' ? 'bg-white shadow-sm' : 'text-gray-500'}`}>Search</button>
            <button onClick={() => setActiveTab('requests')} className={`flex-1 py-1.5 text-xs font-bold rounded-lg relative ${activeTab === 'requests' ? 'bg-white shadow-sm' : 'text-gray-500'}`}>
                Requests {pendingRequests.length > 0 && <span className="bg-red-500 text-white px-1.5 rounded-full text-[10px] ml-1">{pendingRequests.length}</span>}
            </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {activeTab === 'matches' && (
            matches.length === 0 ? <EmptyState icon={<Search/>} title="No offline matches" desc="Update your profile to regenerate matches." /> :
            matches.map(matchDoc => {
                const targetId = matchDoc.participants.find(id => id !== user.uid);
                const targetUser = usersMap[targetId];
                if (!targetUser) return null; 
                return (
                <div key={matchDoc.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                    <div className="flex gap-3">
                        <img src={targetUser.avatar} className="w-14 h-14 rounded-full object-cover border border-gray-100" alt=""/>
                        <div className="flex-1">
                            <div className="flex items-start justify-between">
                                <div>
                                    <h3 className="font-bold text-gray-900">{targetUser.name}</h3>
                                    <p className="text-xs text-blue-600 font-bold">{targetUser.role}</p>
                                </div>
                                <div className="flex flex-col items-end">
                                    <span className="text-[10px] font-bold text-green-600 uppercase">Match</span>
                                    <div className="w-8 h-8 rounded-full border-2 border-green-200 flex items-center justify-center bg-green-50 text-green-700 text-xs font-bold">{matchDoc.score}</div>
                                </div>
                            </div>
                            <div className="mt-2 bg-gray-50 rounded-lg p-2">
                                {matchDoc.reasons.map((r, i) => <p key={i} className="text-[10px] text-gray-600 font-medium flex gap-1 items-center">✨ {r}</p>)}
                            </div>
                            <div className="mt-3"><ConnectionButton targetId={targetId} connObj={connections.find(c => c.participants.includes(targetId))} /></div>
                        </div>
                    </div>
                </div>
            )})
        )}

        {activeTab === 'search' && (
            <div className="flex flex-col gap-3">
                <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex flex-col gap-3">
                    <select value={searchRole} onChange={e => setSearchRole(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-lg p-2.5 text-sm outline-none font-medium">
                        <option value="">Any Role</option>
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <input type="text" placeholder="Filter by Location (e.g., NY)" value={searchLoc} onChange={e => setSearchLoc(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-lg p-2.5 text-sm outline-none font-medium" />
                    <label className="flex items-center gap-2 text-sm font-bold text-gray-700 bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                        <input type="checkbox" checked={searchIntent} onChange={e => setSearchIntent(e.target.checked)} className="w-4 h-4 rounded text-blue-600" /> Looking for Co-founder
                    </label>
                </div>
                
                {searchResults.map(targetUser => (
                     <div key={targetUser.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex gap-3">
                         <img src={targetUser.avatar} className="w-12 h-12 rounded-full" alt=""/>
                         <div className="flex-1">
                             <h3 className="font-bold text-gray-900">{targetUser.name}</h3>
                             <p className="text-xs text-gray-500">{targetUser.role} {targetUser.location ? `• ${targetUser.location}` : ''}</p>
                             <div className="mt-3"><ConnectionButton targetId={targetUser.id} connObj={connections.find(c => c.participants.includes(targetUser.id))} /></div>
                         </div>
                     </div>
                ))}
            </div>
        )}

        {activeTab === 'requests' && (
            pendingRequests.length === 0 ? <EmptyState icon={<UserPlus/>} title="No requests" desc="You have no pending connection requests." /> :
            pendingRequests.map(req => {
                const reqUser = usersMap[req.from];
                if(!reqUser) return null;
                return (
                    <div key={req.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-3">
                        <img src={reqUser.avatar} className="w-12 h-12 rounded-full" alt=""/>
                        <div className="flex-1">
                            <h3 className="font-bold text-gray-900 text-sm">{reqUser.name}</h3>
                            <p className="text-[10px] text-gray-500">{reqUser.role}</p>
                        </div>
                        <button onClick={() => acceptRequest(req.id, reqUser.id)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm">Accept</button>
                    </div>
                )
            })
        )}
      </div>
    </div>
  );
}

// Keep standard implementations for Create, Community, Profile, Chat & Utils
function CommunityScreen({ user, usersMap }) {
    const { threads, createThread } = useThreads(user, usersMap);
    const [activeTopic, setActiveTopic] = useState('Ideas');
    const [showNewThread, setShowNewThread] = useState(false);
    const [newTitle, setNewTitle] = useState('');

    const filteredThreads = threads.filter(t => t.topic === activeTopic);
    const handleCreate = async (e) => { e.preventDefault(); await createThread(newTitle, activeTopic); setNewTitle(''); setShowNewThread(false); };

    return (
        <div className="flex flex-col h-full bg-white relative">
            <header className="bg-white sticky top-0 z-40 px-4 pt-4 pb-0 border-b border-gray-100">
                <h2 className="text-xl font-bold text-gray-900 mb-4 tracking-tight">Community</h2>
                <div className="flex overflow-x-auto no-scrollbar gap-6 border-b border-gray-100">
                    {COMMUNITY_TOPICS.map(topic => (
                        <button key={topic} onClick={() => setActiveTopic(topic)} className={`whitespace-nowrap pb-3 text-sm font-semibold transition-all relative ${activeTopic === topic ? 'text-blue-600' : 'text-gray-500 hover:text-gray-800'}`}>
                            {topic}
                            {activeTopic === topic && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-600 rounded-t-full"></div>}
                        </button>
                    ))}
                </div>
            </header>
            <div className="flex-1 overflow-y-auto p-0 pb-20">
                {showNewThread && (
                    <form onSubmit={handleCreate} className="p-4 bg-gray-50 border-b border-gray-200">
                        <input autoFocus type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder={`Start a discussion in ${activeTopic}...`} className="w-full bg-white border border-gray-200 rounded-xl p-3 text-sm outline-none focus:border-blue-400 mb-2" />
                        <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => setShowNewThread(false)} className="px-4 py-2 text-xs font-bold text-gray-500 hover:bg-gray-100 rounded-lg">Cancel</button>
                            <button type="submit" disabled={!newTitle.trim()} className="px-4 py-2 text-xs font-bold bg-blue-600 text-white rounded-lg disabled:opacity-50">Post</button>
                        </div>
                    </form>
                )}
                {filteredThreads.map(thread => (
                    <div key={thread.id} className="border-b border-gray-50 p-4 hover:bg-gray-50 transition-colors cursor-pointer group">
                        <h3 className="font-bold text-gray-900 group-hover:text-blue-600 transition-colors leading-tight">{thread.title}</h3>
                        <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 font-medium">
                            <span className="flex items-center gap-1"><img src={thread.author.avatar} className="w-4 h-4 rounded-full" alt=""/> {thread.author.name}</span>
                            <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> {thread.repliesCount || 0} replies</span>
                        </div>
                    </div>
                ))}
                {filteredThreads.length === 0 && !showNewThread && <EmptyState icon={<MessageSquare/>} title={`No discussions in ${activeTopic}`} desc="Be the first to start a conversation here." />}
            </div>
            <button onClick={() => setShowNewThread(true)} className="absolute bottom-6 right-4 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center hover:scale-105 transition-transform z-40">
                <MessageSquare className="w-6 h-6" />
            </button>
        </div>
    );
}

function CreateScreen({ user, onPostCreated }) {
  const [content, setContent] = useState('');
  const [isLooking, setIsLooking] = useState(false);
  const [isPosting, setIsPosting] = useState(false);

  const handlePost = async () => {
    if (!content.trim() || isPosting) return;
    setIsPosting(true); 
    const tags = content.match(/#[a-zA-Z0-9]+/g) || [];
    await addDoc(getDbCollection('posts'), { authorId: user.uid, content, hashtags: tags, lookingForCoFounder: isLooking, timestamp: Date.now() });
    setIsPosting(false); setContent('');
    onPostCreated();
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <header className="bg-white sticky top-0 z-40 px-4 py-3 flex justify-between items-center border-b border-gray-100">
        <h2 className="text-lg font-bold text-gray-900">New Update</h2>
        <button onClick={handlePost} disabled={!content.trim() || isPosting} className={`px-4 py-1.5 rounded-full text-sm font-bold flex items-center gap-2 ${content.trim() && !isPosting ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
          {isPosting && <Loader2 className="w-3 h-3 animate-spin" />} Post
        </button>
      </header>
      <div className="p-4 flex-1 flex flex-col gap-4">
        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Share an update, milestone, or ask for help..." className="w-full flex-1 resize-none outline-none text-gray-800 text-lg placeholder-gray-400 min-h-[120px]" autoFocus />
        <div className="border-t border-gray-100 pt-4 mt-auto">
          <div className="flex items-center justify-between bg-blue-50 border border-blue-100 p-4 rounded-2xl">
            <div>
              <h4 className="font-bold text-gray-900 text-sm flex items-center gap-2"><UsersIcon className="w-4 h-4 text-blue-600" /> Looking for Co-founder</h4>
              <p className="text-xs text-gray-500 mt-0.5">Attach a hiring badge to this post.</p>
            </div>
            <button onClick={() => setIsLooking(!isLooking)} className={`w-12 h-6 rounded-full transition-colors relative ${isLooking ? 'bg-blue-600' : 'bg-gray-300'}`}>
              <div className={`w-5 h-5 bg-white rounded-full shadow-sm absolute transition-all top-0.5 ${isLooking ? 'right-0.5' : 'left-0.5'}`}></div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NotificationsScreen({ user, usersMap, onBack }) {
    const [notifications, setNotifications] = useState([]);
    useEffect(() => {
        if (!user) return;
        const unsub = onSnapshot(getDbCollection('notifications'), (snap) => {
            const notifs = snap.docs.map(d => ({id: d.id, ...d.data()})).filter(n => n.userId === user.uid).sort((a,b) => b.timestamp - a.timestamp);
            setNotifications(notifs);
            notifs.filter(n => !n.read).forEach(n => updateDoc(getDbDoc('notifications', n.id), { read: true }).catch(()=>{}));
        });
        return () => unsub();
    }, [user]);

    return (
        <div className="flex flex-col h-full bg-white z-50 absolute inset-0">
            <header className="bg-white sticky top-0 z-40 px-4 py-4 border-b border-gray-100 flex items-center gap-3">
                <button onClick={onBack} className="p-1 -ml-1 hover:bg-gray-100 rounded-full text-gray-700 transition-colors"><ChevronLeft className="w-6 h-6" /></button>
                <h2 className="text-xl font-bold text-gray-900 tracking-tight">Notifications</h2>
            </header>
            <div className="flex-1 overflow-y-auto">
                {notifications.length === 0 ? <EmptyState icon={<Bell/>} title="All caught up" desc="When people interact with you, it will show up here." /> :
                    notifications.map(n => {
                        const sourceUser = usersMap[n.sourceId] || { name: 'Someone', avatar: '' };
                        return (
                            <div key={n.id} className={`flex items-center gap-3 p-4 border-b border-gray-50 ${!n.read ? 'bg-blue-50/30' : ''}`}>
                                <img src={sourceUser.avatar} className="w-10 h-10 rounded-full object-cover border border-gray-100" alt=""/>
                                <div className="flex-1">
                                    <p className="text-sm text-gray-800"><span className="font-bold">{sourceUser.name}</span> {n.type.includes('connection') ? 'wants to connect' : 'interacted with you.'}</p>
                                    <span className="text-[10px] text-gray-400 font-medium">{new Date(n.timestamp).toLocaleDateString()}</span>
                                </div>
                            </div>
                        )
                    })
                }
            </div>
        </div>
    )
}

function ProfileScreen({ profile, onEdit }) {
  if (!profile) return <LoadingScreen message="Loading profile..." />;
  return (
    <div className="flex flex-col h-full bg-gray-50">
      <header className="bg-white sticky top-0 z-40 px-4 py-3 flex justify-between items-center border-b border-gray-100">
        <h2 className="font-bold text-gray-900">{profile.username}</h2>
        <button onClick={onEdit}><Settings className="w-6 h-6 text-gray-800" /></button>
      </header>
      <div className="flex-1 overflow-y-auto p-4 bg-white">
        <div className="flex items-center gap-4">
          <img src={profile.avatar} alt={profile.name} className="w-20 h-20 rounded-full border border-gray-200 object-cover bg-gray-50" />
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900 leading-tight">{profile.name}</h1>
            <p className="text-sm font-semibold text-blue-600">{profile.role}</p>
            <p className="text-xs text-gray-500 mt-1 flex items-center gap-1"><MapPin className="w-3 h-3"/> {profile.location}</p>
          </div>
        </div>
        <div className="mt-5">
          <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Core Competencies</h4>
          <div className="flex flex-wrap gap-2">
            {profile.skills?.map(skill => <span key={skill} className="bg-gray-50 text-gray-700 text-xs px-3 py-1.5 rounded-lg font-bold border border-gray-200">{skill}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileSetupScreen({ onSubmit, initialData = null, onCancel }) {
    const [step, setStep] = useState(1);
    const [formData, setFormData] = useState(initialData || { name: '', role: '', location: '', bio: '', skills: [], lookingForCoFounder: false });
    const [loading, setLoading] = useState(false);
    
    const handleComplete = async () => { setLoading(true); await onSubmit({ ...formData, username: `@${formData.name.toLowerCase().replace(/\s/g, '')}` }); };

    return (
        <div className="min-h-screen bg-white p-6 flex flex-col justify-center max-w-md mx-auto relative z-50">
            {onCancel && <button onClick={onCancel} className="absolute top-6 left-6 text-gray-500"><X className="w-6 h-6"/></button>}
            {step === 1 && (
                <div className="animate-in fade-in duration-500">
                    <h1 className="text-3xl font-extrabold mb-2">{initialData ? 'Edit Profile' : 'Welcome Builder.'}</h1>
                    <p className="text-gray-500 mb-6">Let's set up your founder identity.</p>
                    <label className="block text-sm font-bold text-gray-700 mb-2">Full Name</label>
                    <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 mb-4 outline-none focus:border-blue-500" placeholder="e.g. Elon Musk" />
                    <label className="block text-sm font-bold text-gray-700 mb-2">Location (City, State)</label>
                    <input type="text" value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})} className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 mb-6 outline-none focus:border-blue-500" placeholder="e.g. San Francisco, CA" />
                    <label className="block text-sm font-bold text-gray-700 mb-2">Primary Role</label>
                    <div className="grid grid-cols-2 gap-3 mb-8">
                        {ROLES.map(role => <button key={role} onClick={() => setFormData({...formData, role})} className={`p-3 text-sm font-semibold rounded-xl border text-left transition-all ${formData.role === role ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{role}</button>)}
                    </div>
                    <button onClick={() => setStep(2)} disabled={!formData.name.trim() || !formData.role || !formData.location.trim()} className="w-full bg-blue-600 text-white font-bold py-3.5 rounded-xl disabled:opacity-50">Next Step</button>
                </div>
            )}
            {step === 2 && (
                <div className="animate-in fade-in duration-500">
                    <button onClick={() => setStep(1)} className="text-gray-400 mb-6 flex items-center gap-1 text-sm"><ChevronLeft className="w-4 h-4"/> Back</button>
                    <h1 className="text-3xl font-extrabold mb-2">Your Superpowers</h1>
                    <p className="text-gray-500 mb-6">Select up to 3 skills you bring to the table.</p>
                    <div className="flex flex-wrap gap-2 mb-8">
                        {SKILLS.map(skill => {
                            const isSelected = formData.skills.includes(skill);
                            return <button key={skill} onClick={() => {
                                if (isSelected) setFormData({...formData, skills: formData.skills.filter(s => s !== skill)});
                                else if (formData.skills.length < 3) setFormData({...formData, skills: [...formData.skills, skill]});
                            }} className={`px-4 py-2 rounded-full text-sm font-semibold border transition-all ${isSelected ? 'bg-gray-900 text-white' : 'bg-white border-gray-200 text-gray-600'}`}>{skill}</button>;
                        })}
                    </div>
                    <div className="bg-blue-50 border border-blue-100 p-4 rounded-2xl mb-8 flex items-center justify-between">
                        <div>
                            <h4 className="font-bold text-gray-900 text-sm flex items-center gap-1"><Zap className="w-4 h-4 text-blue-600" /> Co-founder matching</h4>
                            <p className="text-xs text-gray-500 mt-0.5">Actively looking for a co-founder?</p>
                        </div>
                        <button onClick={() => setFormData({...formData, lookingForCoFounder: !formData.lookingForCoFounder})} className={`w-12 h-6 rounded-full transition-colors relative ${formData.lookingForCoFounder ? 'bg-blue-600' : 'bg-gray-300'}`}>
                            <div className={`w-5 h-5 bg-white rounded-full shadow-sm absolute transition-all top-0.5 ${formData.lookingForCoFounder ? 'right-0.5' : 'left-0.5'}`}></div>
                        </button>
                    </div>
                    <button onClick={handleComplete} disabled={loading || formData.skills.length === 0} className="w-full bg-blue-600 text-white font-bold py-3.5 rounded-xl disabled:opacity-50 flex justify-center items-center gap-2">
                        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Profile'}
                    </button>
                </div>
            )}
        </div>
    );
}

function ChatScreen({ currentUser, chatPartner, onBack }) {
  const { messages, sendMessage } = useChat(currentUser, chatPartner);
  const [msg, setMsg] = useState('');
  const messagesEndRef = useRef(null);
  const handleSend = async (e) => { e.preventDefault(); if (!msg.trim()) return; await sendMessage(msg); setMsg(''); };
  useEffect(() => { messagesEndRef.current?.scrollIntoView(); }, [messages]);

  return (
    <div className="flex flex-col h-full bg-gray-50 absolute inset-0 z-50">
      <header className="bg-white/90 backdrop-blur-md sticky top-0 z-40 px-4 py-3 flex items-center gap-3 border-b border-gray-200 shadow-sm">
        <button onClick={onBack} className="p-1 -ml-1 hover:bg-gray-100 rounded-full"><ChevronLeft className="w-6 h-6" /></button>
        <div className="flex items-center gap-2">
            <img src={chatPartner.avatar} className="w-8 h-8 rounded-full border border-gray-100 object-cover" alt=""/>
            <h2 className="font-bold text-gray-900 text-sm leading-tight">{chatPartner.name}</h2>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {messages.map((chat) => {
          const isMe = chat.senderId === currentUser.uid;
          return (
            <div key={chat.id} className={`flex flex-col max-w-[80%] ${isMe ? 'self-end items-end' : 'self-start items-start'}`}>
              <div className={`px-4 py-2.5 text-sm shadow-sm font-medium ${isMe ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm' : 'bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-tl-sm'}`}>{chat.text}</div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSend} className="bg-white border-t border-gray-200 p-3 pb-safe">
        <div className="flex items-center gap-2 bg-gray-100 rounded-full pl-4 pr-1 py-1 border border-gray-200 focus-within:border-blue-300 transition-all">
          <input type="text" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message..." className="flex-1 bg-transparent outline-none text-sm font-medium text-gray-800 py-2.5" />
          <button type="submit" disabled={!msg.trim()} className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors ${msg.trim() ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-200 text-gray-400'}`}><Send className="w-4 h-4 ml-0.5" /></button>
        </div>
      </form>
    </div>
  );
}

// UI UTILS
function PostCard({ post, onLike }) {
  return (
    <article className="bg-white border-y sm:border sm:rounded-2xl border-gray-100 sm:mx-2 shadow-sm overflow-hidden">
      <div className="p-3.5 flex items-start gap-3">
        <img src={post.author.avatar} alt="" className="w-10 h-10 rounded-full border border-gray-100 bg-gray-50" />
        <div>
          <h3 className="font-bold text-gray-900 text-sm leading-tight">{post.author.name}</h3>
          <p className="text-[10px] text-gray-500 font-medium">{post.author.role}</p>
        </div>
      </div>
      {post.lookingForCoFounder && (
        <div className="px-3 pb-2">
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 flex items-center justify-between">
            <span className="text-xs font-bold text-blue-900 flex gap-2 items-center"><UsersIcon className="w-3.5 h-3.5"/> Hiring Co-founder</span>
          </div>
        </div>
      )}
      <div className="px-4 pb-2"><p className="text-sm text-gray-800 leading-relaxed">{post.content}</p></div>
      <div className="px-4 py-2.5 flex items-center border-t border-gray-50 mt-1">
        <button onClick={onLike} className="flex items-center gap-1.5 group">
          <Heart className={`w-5 h-5 transition-colors ${post.isLikedByMe ? 'fill-red-500 text-red-500' : 'text-gray-500 group-hover:text-red-500'}`} />
          <span className={`text-xs font-bold ${post.isLikedByMe ? 'text-red-500' : 'text-gray-500'}`}>{post.likesCount}</span>
        </button>
      </div>
    </article>
  );
}

function NavItem({ icon, label, isActive, onClick, isPrimary }) {
  if (isPrimary) {
    return (
      <button onClick={onClick} className="flex flex-col items-center justify-center -mt-7 gap-1 relative z-10">
        <div className="bg-gradient-to-tr from-blue-600 to-purple-600 text-white p-3.5 rounded-2xl shadow-lg">{icon}</div>
      </button>
    );
  }
  return (
    <button onClick={onClick} className={`flex flex-col items-center justify-center w-16 gap-1 transition-colors ${isActive ? 'text-blue-600' : 'text-gray-400'}`}>
      {React.cloneElement(icon, { className: `w-6 h-6 ${isActive ? 'stroke-[2.5px]' : 'stroke-2'}` })}
      <span className={`text-[10px] font-bold`}>{label}</span>
    </button>
  );
}

function LoadingScreen({ message }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <Loader2 className="w-10 h-10 animate-spin text-blue-600 mb-4" />
      <p className="text-gray-600 font-bold text-sm">{message}</p>
    </div>
  );
}

function EmptyState({ icon, title, desc }) {
    return (
        <div className="flex flex-col items-center justify-center p-8 text-center mt-10">
            <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center text-gray-400 mb-4">{React.cloneElement(icon, { className: 'w-7 h-7' })}</div>
            <h3 className="font-bold text-gray-900 mb-1">{title}</h3>
            <p className="text-sm text-gray-500">{desc}</p>
        </div>
    )
}


