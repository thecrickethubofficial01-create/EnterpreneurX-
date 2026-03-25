import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp } from 'firebase/firestore';
import { Rocket, Users, MessageSquare, LogOut, Plus, Send } from 'lucide-react';

// --- YOUR UPDATED FIREBASE KEYS ---
const firebaseConfig = {
  apiKey: "AIzaSyDm3gyt4-qPLqspuIizKmtu8YWi1tao0I4",
  authDomain: "enterpreneurx-59f95.firebaseapp.com",
  projectId: "enterpreneurx-59f95",
  storageBucket: "enterpreneurx-59f95.firebasestorage.app",
  messagingSenderId: "596633861971",
  appId: "1:596633861971:web:5e38a242e82c759acf2ba6",
  measurementId: "G-1VZKTZ0VH4"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

export default function EntrepreneurX() {
  const [user, setUser] = useState(null);
  const [posts, setPosts] = useState([]);
  const [newPost, setNewPost] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (s) => {
      setPosts(s.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
  }, [user]);

  const handleLogin = () => signInWithPopup(auth, provider).catch(err => alert(err.message));

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 text-white text-center">
        <Rocket className="w-20 h-20 text-blue-500 mb-6 animate-bounce" />
        <h1 className="text-5xl font-extrabold mb-4 bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
          EntrepreneurX
        </h1>
        <p className="text-slate-400 text-lg mb-8 max-w-sm">Build the future with other young founders.</p>
        <button 
          onClick={handleLogin}
          className="bg-blue-600 hover:bg-blue-700 px-10 py-4 rounded-full font-bold text-xl transition-all shadow-lg shadow-blue-500/20"
        >
          Join the Movement
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <nav className="bg-white border-b p-4 flex justify-between items-center sticky top-0 z-10">
        <h1 className="text-2xl font-black text-blue-600 tracking-tighter">EX</h1>
        <div className="flex items-center gap-3">
          <img src={user.photoURL} className="w-8 h-8 rounded-full border border-blue-500" alt="me" />
          <button onClick={() => signOut(auth)} className="text-slate-400"><LogOut size={20}/></button>
        </div>
      </nav>

      <main className="p-4 max-w-xl mx-auto w-full pb-20">
        <div className="bg-white p-4 rounded-2xl shadow-sm border mb-6">
          <textarea 
            className="w-full p-2 focus:outline-none text-lg" 
            placeholder="Share your startup progress..."
            rows="3"
            value={newPost}
            onChange={(e) => setNewPost(e.target.value)}
          />
          <div className="flex justify-end pt-2 border-t mt-2">
            <button 
              onClick={async () => {
                if(!newPost.trim()) return;
                await addDoc(collection(db, 'posts'), {
                  text: newPost,
                  author: user.displayName,
                  authorPhoto: user.photoURL,
                  createdAt: serverTimestamp()
                });
                setNewPost('');
              }}
              className="bg-blue-600 text-white px-6 py-2 rounded-xl font-bold flex items-center gap-2"
            >
              <Send size={16}/> Post
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {posts.map(p => (
            <div key={p.id} className="bg-white p-5 rounded-2xl shadow-sm border">
              <div className="flex items-center gap-3 mb-3">
                <img src={p.authorPhoto} className="w-10 h-10 rounded-full" alt="founder" />
                <p className="font-bold text-slate-800">{p.author}</p>
              </div>
              <p className="text-slate-700 text-lg">{p.text}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
