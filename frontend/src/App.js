import React from 'react';
import Game from './components/Game';
import AdminPanel from './pages/AdminPanel';

export default function App() {
  const isAdmin = window.location.pathname.startsWith('/admin');
  return isAdmin ? <AdminPanel /> : <Game />;
}
