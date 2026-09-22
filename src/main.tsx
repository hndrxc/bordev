import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GameScreen } from './app/GameScreen';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing React root');

createRoot(root).render(
  <StrictMode>
    <GameScreen />
  </StrictMode>,
);
