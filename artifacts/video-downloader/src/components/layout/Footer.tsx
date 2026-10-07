import { Download, Twitter, Github, Heart } from "lucide-react";

const PRODUCT_LINKS = [
  { label: "How it Works", href: "#how-it-works" },
  { label: "Supported Sites", href: "#platforms" },
  { label: "Reviews", href: "#faq" },
  { label: "FAQ", href: "#faq" },
];

const LEGAL_LINKS = [
  { label: "Terms of Service", href: "#" },
  { label: "Privacy Policy", href: "#" },
  { label: "DMCA", href: "#" },
];

const PLATFORMS = [
  "YouTube", "TikTok", "Instagram", "Twitter / X",
  "Facebook", "Reddit", "Vimeo", "Pinterest",
];

export function Footer() {
  return (
    <footer className="border-t border-white/8 bg-slate-950/80 pt-16 pb-8 mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Top grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 mb-14">

          {/* Brand */}
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/25">
                <Download className="w-3.5 h-3.5 text-white" strokeWidth={3} />
              </div>
              <span className="font-display font-bold text-lg text-white tracking-tight">
                MR <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400">DEVIL</span>
              </span>
            </div>
            <p className="text-slate-400 text-sm leading-relaxed mb-5">
              The fastest, most reliable way to download high-quality videos from YouTube, TikTok, Instagram, and 1000+ sites. Free. No watermarks. No signup.
            </p>
            <div className="flex items-center gap-3">
              <a
                href="https://twitter.com"
                target="_blank"
                rel="noreferrer"
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all"
                aria-label="Twitter"
              >
                <Twitter className="w-4 h-4" />
              </a>
              <a
                href="https://github.com"
                target="_blank"
                rel="noreferrer"
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all"
                aria-label="GitHub"
              >
                <Github className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Product */}
          <div>
            <h3 className="font-semibold text-white mb-4 text-sm tracking-wide uppercase opacity-60">Product</h3>
            <ul className="space-y-3">
              {PRODUCT_LINKS.map(l => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    className="text-sm text-slate-400 hover:text-white transition-colors"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="font-semibold text-white mb-4 text-sm tracking-wide uppercase opacity-60">Legal</h3>
            <ul className="space-y-3">
              {LEGAL_LINKS.map(l => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    className="text-sm text-slate-400 hover:text-white transition-colors"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Platforms */}
          <div>
            <h3 className="font-semibold text-white mb-4 text-sm tracking-wide uppercase opacity-60">Platforms</h3>
            <ul className="space-y-3">
              {PLATFORMS.map(p => (
                <li key={p}>
                  <span className="text-sm text-slate-400">{p}</span>
                </li>
              ))}
              <li>
                <span className="text-sm text-slate-500">+ 1,000 more sites</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-white/8 pt-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-slate-500 text-center sm:text-left">
            © {new Date().getFullYear()} MR DEVIL VIDEO DOWNLOADER. All rights reserved.
            Not affiliated with YouTube, TikTok, Meta, or any third-party platform.
          </p>
          <p className="text-xs text-slate-600 flex items-center gap-1.5 shrink-0">
            Made with <Heart className="w-3 h-3 text-pink-500 fill-pink-500" /> for creators
          </p>
        </div>
      </div>
    </footer>
  );
}
