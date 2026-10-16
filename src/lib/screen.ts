/** Qualidade válida mesmo se um valor antigo (ex.: 1440p/15 fps) estiver salvo. */
export function screenPreset(q: string, fps: number) {
  const quality: '720p' | '1080p' = q === '720p' ? '720p' : '1080p'
  const rate = fps === 60 ? 60 : 30
  const [width, height] = quality === '720p' ? [1280, 720] : [1920, 1080]
  // taxa máxima de bits por combinação (kbps → bps); 1080p60 é o mais pesado
  const kbps = { '720p': { 30: 2500, 60: 4000 }, '1080p': { 30: 4500, 60: 7000 } }[quality][rate]
  return { quality, fps: rate as 30 | 60, resolution: { width, height, frameRate: rate }, maxBitrate: kbps * 1000 }
}
