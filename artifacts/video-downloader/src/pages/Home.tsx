import { motion } from "framer-motion";
import { Zap, ShieldCheck, Infinity, CheckCircle2 } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { VideoDownloader } from "@/components/video/VideoDownloader";
import { LiveStats } from "@/components/LiveStats";
import { TrendingSection } from "@/components/TrendingSection";
import { ReviewSection } from "@/components/ReviewSection";

const SUPPORTED_PLATFORMS = [
  { name: "YouTube" },
  { name: "TikTok" },
  { name: "Instagram" },
  { name: "Facebook" },
  { name: "Twitter / X" },
  { name: "Pinterest" },
  { name: "Reddit" },
  { name: "Vimeo" },
  { name: "Twitch" },
  { name: "Dailymotion" },
  { name: "SoundCloud" },
  { name: "LinkedIn" },
];

const FEATURES = [
  {
    icon: <Zap className="w-6 h-6 text-purple-400" />,
    title: "Lightning Fast",
    description: "Our distributed backend pulls video streams directly and routes them to you with maximum bandwidth."
  },
  {
    icon: <ShieldCheck className="w-6 h-6 text-indigo-400" />,
    title: "100% Safe & Secure",
    description: "No tracking, no logs, no sketchy popups. We value your privacy and don't store your downloaded files."
  },
  {
    icon: <Infinity className="w-6 h-6 text-pink-400" />,
    title: "Unlimited Downloads",
    description: "Download as many videos as you want. No hourly limits, no premium paywalls, no registration required."
  }
];

const SEO_KEYWORDS = [
  "#MrDevilVideoDownloader", "#VideoDownloader", "#FreeDownloader",
  "#ReelsDownloader", "#TikTokDownloader", "#InstagramDownloader",
  "#YouTubeDownloader", "#HDVideoDownload", "#NoWatermark",
];

export default function Home() {
  return (
    <div className="relative min-h-screen flex flex-col">
      {/* Hidden SEO keywords */}
      <span className="sr-only" aria-hidden="true">
        {SEO_KEYWORDS.join(" ")} video downloader online tiktok video downloader hd
        instagram reel downloader youtube shorts downloader mr devil video downloader
        download tiktok without watermark instagram reels downloader free
      </span>

      {/* Background */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[900px] h-[700px] bg-gradient-radial opacity-30" />
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-indigo-950/20 via-transparent to-purple-950/20" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-slate-950/60 to-slate-950" />
      </div>

      <Navbar />

      <main className="flex-1 relative z-10 pt-32 pb-16">

        {/* Hero Section */}
        <section className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto text-center mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-white mb-6">
              Download Any Video.<br />
              <span className="text-gradient">Fast & Free.</span>
            </h1>
            <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
              Save high-quality videos and audio from YouTube, TikTok, Instagram, Twitter, and 1000+ other sites — no watermark, no signup.
            </p>
          </motion.div>

          {/* Live Stats Bar */}
          <LiveStats />

          <VideoDownloader />
        </section>

        {/* Features Section */}
        <section id="how-it-works" className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto py-24">
          <div className="grid md:grid-cols-3 gap-8">
            {FEATURES.map((feature, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: idx * 0.1 }}
                className="glass-panel p-8 rounded-2xl hover:-translate-y-1 transition-transform duration-300"
              >
                <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-6">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-bold text-white mb-3">{feature.title}</h3>
                <p className="text-slate-400 leading-relaxed">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Trending Section */}
        <TrendingSection />

        {/* Supported Platforms */}
        <section id="platforms" className="px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto py-20 text-center border-t border-white/5">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Supported Platforms</h2>
          <p className="text-slate-400 mb-12 max-w-2xl mx-auto">
            Powered by advanced extraction technology supporting over 1,000 video hosting sites and social networks.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {SUPPORTED_PLATFORMS.map((platform) => (
              <div
                key={platform.name}
                className="glass-panel px-5 py-2.5 rounded-full flex items-center gap-2 transition-all duration-300 hover:bg-white/10 cursor-default"
              >
                <span className="font-medium text-slate-300 text-sm">{platform.name}</span>
              </div>
            ))}
            <div className="glass-panel px-5 py-2.5 rounded-full flex items-center gap-2">
              <span className="font-medium text-slate-400 text-sm">+ 1000 more</span>
            </div>
          </div>
        </section>

        {/* Ratings & Reviews */}
        <ReviewSection />

        {/* FAQ */}
        <section id="faq" className="px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto py-24 border-t border-white/5">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-10 text-center">Frequently Asked Questions</h2>
          <div className="space-y-6">
            {[
              {
                q: "Is it completely free to use?",
                a: "Yes! MR DEVIL VIDEO DOWNLOADER is 100% free with no premium tiers, subscriptions, or hidden fees. No registration required."
              },
              {
                q: "What video qualities are available?",
                a: "We offer all available quality tiers: 4K (2160p), 1440p, 1080p, 720p, 480p, 360p, 240p, and 144p for every platform. Videos are encoded in H.264 MP4 — universally compatible with all devices and platforms."
              },
              {
                q: "Do you keep a copy of my downloaded videos?",
                a: "No. We process extraction on our servers and send the direct stream to you. Files are deleted within minutes. We keep no logs of what you download."
              },
              {
                q: "Can I download videos on my iPhone or Android?",
                a: "Yes! Our website is fully responsive and works on all mobile browsers. On iOS, downloads save directly to your Files app. On Android, they go to your Downloads folder."
              },
              {
                q: "Why did my download fail?",
                a: "Downloads fail if a video is private, geo-restricted, or if the platform recently updated. Try again in a few minutes or check that the URL works in an incognito browser tab."
              },
              {
                q: "Can I download without a watermark?",
                a: "Yes! We download directly from the original source — no re-encoding or watermarks added. TikTok videos are downloaded in their original quality without the TikTok watermark."
              }
            ].map((faq, i) => (
              <div key={i} className="glass-panel p-6 rounded-2xl">
                <h3 className="text-lg font-bold text-white mb-2 flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                  {faq.q}
                </h3>
                <p className="text-slate-400 pl-8 leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </section>

      </main>

      <Footer />
    </div>
  );
}
