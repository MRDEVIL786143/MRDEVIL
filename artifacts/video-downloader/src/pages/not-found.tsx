import { Link } from "wouter";
import { Home, AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="glass-panel max-w-md w-full p-8 rounded-2xl text-center">
        <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertCircle className="w-8 h-8 text-pink-500" />
        </div>
        <h1 className="text-4xl font-display font-bold text-white mb-2">404</h1>
        <p className="text-slate-400 mb-8 text-lg">
          Oops! The page you're looking for doesn't exist or has been moved.
        </p>
        <Link 
          href="/" 
          className="inline-flex items-center justify-center gap-2 bg-gradient-primary text-white font-semibold px-6 py-3 rounded-xl transition-transform hover:-translate-y-0.5 active:translate-y-0"
        >
          <Home className="w-5 h-5" />
          Back to Home
        </Link>
      </div>
    </div>
  );
}
