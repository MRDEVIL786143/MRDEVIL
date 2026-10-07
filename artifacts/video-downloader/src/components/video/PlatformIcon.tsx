import {
  Youtube,
  Instagram,
  Facebook,
  Twitter,
  Globe,
  Music,
  Video,
  Linkedin,
  Rss,
} from "lucide-react";

interface PlatformIconProps {
  url: string;
  className?: string;
}

export function PlatformIcon({ url, className = "w-6 h-6" }: PlatformIconProps) {
  const l = url.toLowerCase();

  if (l.includes("youtube.com") || l.includes("youtu.be"))
    return <Youtube className={`${className} text-[#FF0000]`} />;

  if (l.includes("instagram.com"))
    return <Instagram className={`${className} text-[#E1306C]`} />;

  if (l.includes("facebook.com") || l.includes("fb.watch") || l.includes("fb.com"))
    return <Facebook className={`${className} text-[#1877F2]`} />;

  if (l.includes("twitter.com") || l.includes("x.com") || l.includes("t.co"))
    return <Twitter className={`${className} text-slate-200`} />;

  if (l.includes("tiktok.com") || l.includes("vm.tiktok"))
    return (
      <span className={`${className} flex items-center justify-center font-black text-[10px] text-[#00f2fe] leading-none`}>
        TT
      </span>
    );

  if (l.includes("reddit.com") || l.includes("redd.it"))
    return (
      <span className={`${className} flex items-center justify-center font-black text-[10px] text-[#FF4500] leading-none`}>
        r/
      </span>
    );

  if (l.includes("pinterest.com") || l.includes("pin.it"))
    return (
      <span className={`${className} flex items-center justify-center font-black text-[12px] text-[#E60023] leading-none`}>
        P
      </span>
    );

  if (l.includes("vimeo.com"))
    return <Video className={`${className} text-[#1AB7EA]`} />;

  if (l.includes("twitch.tv"))
    return (
      <span className={`${className} flex items-center justify-center font-black text-[10px] text-[#9147FF] leading-none`}>
        TV
      </span>
    );

  if (l.includes("dailymotion.com"))
    return <Video className={`${className} text-[#0066DC]`} />;

  if (l.includes("soundcloud.com"))
    return <Music className={`${className} text-[#FF5500]`} />;

  if (l.includes("linkedin.com"))
    return <Linkedin className={`${className} text-[#0A66C2]`} />;

  if (l.includes("snapchat.com"))
    return (
      <span className={`${className} flex items-center justify-center font-black text-[12px] text-[#FFFC00] leading-none`}>
        S
      </span>
    );

  if (l.includes("bilibili.com"))
    return <Rss className={`${className} text-[#00AEEC]`} />;

  return <Globe className={`${className} text-slate-400`} />;
}

export function getPlatformColor(url: string): string {
  const l = url.toLowerCase();
  if (l.includes("youtube.com") || l.includes("youtu.be")) return "#FF0000";
  if (l.includes("instagram.com")) return "#E1306C";
  if (l.includes("facebook.com") || l.includes("fb.watch")) return "#1877F2";
  if (l.includes("twitter.com") || l.includes("x.com")) return "#ffffff";
  if (l.includes("tiktok.com")) return "#00f2fe";
  if (l.includes("reddit.com")) return "#FF4500";
  if (l.includes("vimeo.com")) return "#1AB7EA";
  if (l.includes("pinterest.com")) return "#E60023";
  return "#6366f1";
}
