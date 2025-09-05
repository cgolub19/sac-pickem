import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
/* For wider screens, switch back to 2 columns */
.live-picks-grid {
  grid-template-columns: 1fr;
}

@media (min-width: 640px) {
  .live-picks-grid {
    grid-template-columns: 1fr 1fr;
    column-gap: 16px;
  }
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
