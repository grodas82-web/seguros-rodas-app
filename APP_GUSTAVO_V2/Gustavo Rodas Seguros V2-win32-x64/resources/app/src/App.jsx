import React from 'react';
import Layout from './components/Layout';
import Auth from './components/Auth';
import SplashScreen from './components/SplashScreen';
import { useAppContext } from './context/AppContext';

function App() {
  const { user, loading } = useAppContext();

  if (loading) return <SplashScreen loading={true} />;

  return (
    user ? <Layout /> : <Auth />
  );
}

export default App;
