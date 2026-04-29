import React from 'react';

// Shroomi mascot: a single import map for all available poses.
// Each pose is a tightly trimmed PNG with transparent background so it
// can be dropped onto any background without a white halo.
//
// Usage:
//   <Shroomi pose="wave" size={88} />
//   <Shroomi pose="clipboard-write" className="shroomi-float" />
import poseBalloons from '../assets/shroomi/pose-balloons.png';
import poseCalendarBig from '../assets/shroomi/pose-calendar-big.png';
import poseCalendarSmall from '../assets/shroomi/pose-calendar-small.png';
import poseCheckQuestion from '../assets/shroomi/pose-check-question.png';
import poseCheckmarkConfirm from '../assets/shroomi/pose-checkmark-confirm.png';
import poseClipboardWrite from '../assets/shroomi/pose-clipboard-write.png';
import poseClock from '../assets/shroomi/pose-clock.png';
import poseGiftMagic from '../assets/shroomi/pose-gift-magic.png';
import poseGoldRun from '../assets/shroomi/pose-gold-run.png';
import poseHeartHold from '../assets/shroomi/pose-heart-hold.png';
import poseHugging from '../assets/shroomi/pose-hugging.png';
import poseJumpCheer from '../assets/shroomi/pose-jump-cheer.png';
import posePartyBig from '../assets/shroomi/pose-party-big.png';
import posePartyCoins from '../assets/shroomi/pose-party-coins.png';
import posePartyConfetti from '../assets/shroomi/pose-party-confetti.png';
import posePawsUp from '../assets/shroomi/pose-paws-up.png';
import posePhonePhoto from '../assets/shroomi/pose-phone-photo.png';
import posePhone from '../assets/shroomi/pose-phone.png';
import posePointJump from '../assets/shroomi/pose-point-jump.png';
import posePointSide from '../assets/shroomi/pose-point-side.png';
import posePoint from '../assets/shroomi/pose-point.png';
import posePrayer from '../assets/shroomi/pose-prayer.png';
import poseShyPaws from '../assets/shroomi/pose-shy-paws.png';
import poseTagDiscount from '../assets/shroomi/pose-tag-discount.png';
import poseThumbsUpBig from '../assets/shroomi/pose-thumbs-up-big.png';
import poseThumbsUp from '../assets/shroomi/pose-thumbs-up.png';
import poseWave2 from '../assets/shroomi/pose-wave2.png';
import poseWave from '../assets/shroomi/pose-wave.png';

const POSES = {
  balloons: poseBalloons,
  'calendar-big': poseCalendarBig,
  'calendar-small': poseCalendarSmall,
  'check-question': poseCheckQuestion,
  'checkmark-confirm': poseCheckmarkConfirm,
  'clipboard-write': poseClipboardWrite,
  clock: poseClock,
  'gift-magic': poseGiftMagic,
  'gold-run': poseGoldRun,
  'heart-hold': poseHeartHold,
  hugging: poseHugging,
  'jump-cheer': poseJumpCheer,
  'party-big': posePartyBig,
  'party-coins': posePartyCoins,
  'party-confetti': posePartyConfetti,
  'paws-up': posePawsUp,
  'phone-photo': posePhonePhoto,
  phone: posePhone,
  'point-jump': posePointJump,
  'point-side': posePointSide,
  point: posePoint,
  prayer: posePrayer,
  'shy-paws': poseShyPaws,
  'tag-discount': poseTagDiscount,
  'thumbs-up-big': poseThumbsUpBig,
  'thumbs-up': poseThumbsUp,
  wave2: poseWave2,
  wave: poseWave,
};

export default function Shroomi({
  pose = 'wave',
  size = 80,
  className = '',
  alt = '',
  decorative = true,
  style,
  ...rest
}) {
  const src = POSES[pose] || POSES.wave;
  const dim = typeof size === 'number' ? `${size}px` : size;
  return (
    <img
      src={src}
      alt={decorative ? '' : alt}
      aria-hidden={decorative ? 'true' : undefined}
      className={`shroomi-img ${className}`.trim()}
      loading="lazy"
      decoding="async"
      draggable="false"
      style={{ width: dim, height: dim, objectFit: 'contain', ...style }}
      data-shroomi-pose={pose}
      {...rest}
    />
  );
}
