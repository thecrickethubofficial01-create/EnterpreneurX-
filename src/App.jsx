import React, { useState, useEffect } from 'react';
import { Rocket, Users, MessageSquare, LogOut, Plus } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp } from 'firebase/firestore';

// --- Yahan apni Firebase keys dalo ---
const firebaseConfig = {
  apiKey: "AIzaSy...", 
  authDomain: "enterpreneurx-59f95.firebaseapp.com",
  projectId: "enterpreneurx-59f95",
  storageBucket: "enterpreneurx-59f95.appspot.com",
  messagingSenderId: "YOUR_ID",
  appId: "YOUR_APP_ID"
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
    return onSnapshot(q, (s) => setPosts(s.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [user]);

  if (!user) return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 text-white">
      <Rocket className="w-16 h-16 text-blue-500 mb-4 animate-bounce" />
      <h1 className="text-4xl font-bold mb-6">EntrepreneurX</h1>
      <button onClick={() => signInWithPopup(auth, provider)} className="bg-blue-600 px-8 py-3 rounded-full font-bold">
        Join the Movement
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <nav className="flex justify-between items-center mb-6">
        <h1 className="text-xl font-bold text-blue-600">EntrepreneurX</h1>
        <button onClick={() => signOut(auth)}><LogOut /></button>
      </nav>
      <div className="bg-white p-4 rounded-xl shadow mb-6">
        <textarea 
          className="w-full p-2 border rounded" 
          placeholder="What's your startup idea?"
          value={newPost}
          onChange={(e) => setNewPost(e.target.value)}
        />
        <button 
          onClick={async () => {
            if(!newPost) return;
            await addDoc(collection(db, 'posts'), { text: newPost, author: user.displayName, createdAt: serverTimestamp() });
            setNewPost('');
          }}
          className="bg-blue-600 text-white px-4 py-2 mt-2 rounded"
        >Post</button>
      </div>
      {posts.map(p => (
        <div key={p.id} className="bg-white p-4 rounded-xl shadow mb-3">
          <p className="font-bold">{p.author}</p>
          <p>{p.text}</p>
        </div>
      ))}
    </div>
  );
}
