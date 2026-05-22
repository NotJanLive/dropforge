import { useEffect, useState } from "react";

export function TwitchImage({
  src,
  alt,
  className,
  fallbackClassName,
  fallbackSrc,
}: {
  src: string;
  alt: string;
  className: string;
  fallbackClassName?: string;
  fallbackSrc?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [activeSrc, setActiveSrc] = useState(src || fallbackSrc || "");

  useEffect(() => {
    setFailed(false);
    setActiveSrc(src || fallbackSrc || "");
  }, [src, fallbackSrc]);

  if (!activeSrc || failed) {
    return <div className={fallbackClassName ?? className} aria-hidden />;
  }

  return (
    <img
      src={activeSrc}
      alt={alt}
      className={className}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => {
        if (fallbackSrc && activeSrc !== fallbackSrc) {
          setActiveSrc(fallbackSrc);
          return;
        }
        setFailed(true);
      }}
    />
  );
}
