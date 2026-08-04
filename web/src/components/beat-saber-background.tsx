import { BeatSaberParticles } from "@/components/beat-saber-particles";

export function BeatSaberBackground() {
  return (
    <div className="beat-saber-background" aria-hidden="true">
      <div className="beat-saber-background-field">
        <BeatSaberParticles />
        <div className="beat-saber-floor-haze" />
        <div className="beat-saber-vignette" />
      </div>
      <div className="beat-saber-darkening" />
    </div>
  );
}
