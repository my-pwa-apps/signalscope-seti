import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { MobileNav } from './components/layout/MobileNav';
import { Dashboard } from './pages/Dashboard';
import { LiveAnalysis } from './pages/LiveAnalysis';
import { Findings } from './pages/Findings';
import { Learn } from './pages/Learn';

// Space map is heavy (three.js) — lazy-load it.
const SpaceMapPage = lazy(() =>
  import('./pages/SpaceMapPage').then((m) => ({ default: m.SpaceMapPage }))
);

export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}

function Shell() {
  const loc = useLocation();
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main key={loc.pathname} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8">
          <Suspense fallback={<div className="p-10 text-slate-500">Loading scene…</div>}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/live" element={<LiveAnalysis />} />
              <Route path="/sky" element={<SpaceMapPage />} />
              <Route path="/findings" element={<Findings />} />
              <Route path="/learn" element={<Learn />} />
            </Routes>
          </Suspense>
        </main>
        <Footer />
        <MobileNav />
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/5 px-6 py-5 text-center text-[11px] leading-relaxed text-slate-500 md:text-left">
      SignalScope SETI · educational prototype · not affiliated with any official SETI
      working group · analyzes public or user-supplied filterbank data locally · see Learn for the full disclaimer.
    </footer>
  );
}
