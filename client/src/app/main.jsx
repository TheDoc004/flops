import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installNumberInputWheelGuard } from '../shared/utils/numberInputWheelGuard';
import '../styles/index.css';

// Scrolling must never edit a number field — see the guard for why.
installNumberInputWheelGuard();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
