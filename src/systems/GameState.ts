export type UpgradeId =
  | "fireballSkill"
  | "meteorCore"
  | "cooldown"
  | "projectiles"
  | "arcaneRing"
  | "celestialHalo"
  | "chainLightning"
  | "thunderDominion"
  | "speed"
  | "magnet"
  | "maxHp";

export type UpgradeOption = {
  id: UpgradeId;
  title: string;
  description: string;
};

export type PlayerStats = {
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  xpToNext: number;
  damage: number;
  fireballLevel: number;
  fireCooldownMs: number;
  projectileCount: number;
  fireballHits: number;
  fireballSize: number;
  fireballSpeed: number;
  fireballLifetimeMs: number;
  meteorCoreUnlocked: boolean;
  arcaneRingLevel: number;
  ringOrbCount: number;
  ringDamage: number;
  ringRadius: number;
  ringSpinSpeed: number;
  celestialHaloUnlocked: boolean;
  lightningLevel: number;
  lightningDamage: number;
  lightningCooldownMs: number;
  lightningChains: number;
  thunderDominionUnlocked: boolean;
  speed: number;
  magnetRadius: number;
};

export class GameState {
  stats: PlayerStats = {
    hp: 100,
    maxHp: 100,
    level: 1,
    xp: 0,
    xpToNext: 5,
    damage: 56,
    fireballLevel: 1,
    fireCooldownMs: 440,
    projectileCount: 1,
    fireballHits: 2,
    fireballSize: 18,
    fireballSpeed: 980,
    fireballLifetimeMs: 1150,
    meteorCoreUnlocked: false,
    arcaneRingLevel: 0,
    ringOrbCount: 0,
    ringDamage: 22,
    ringRadius: 86,
    ringSpinSpeed: 2.8,
    celestialHaloUnlocked: false,
    lightningLevel: 0,
    lightningDamage: 38,
    lightningCooldownMs: 1650,
    lightningChains: 0,
    thunderDominionUnlocked: false,
    speed: 230,
    magnetRadius: 84
  };

  elapsedMs = 0;
  kills = 0;
  pausedForUpgrade = false;
  gameOver = false;

  addXp(amount: number): boolean {
    this.stats.xp += amount;
    if (this.stats.xp < this.stats.xpToNext) {
      return false;
    }

    this.stats.xp -= this.stats.xpToNext;
    this.stats.level += 1;
    this.stats.xpToNext = Math.ceil(this.stats.xpToNext * 1.35 + 3);
    this.pausedForUpgrade = true;
    return true;
  }

  applyUpgrade(id: UpgradeId): void {
    const stats = this.stats;
    if (id === "fireballSkill") {
      stats.fireballLevel = Math.min(8, stats.fireballLevel + 1);
      stats.damage += 8;
      stats.fireCooldownMs = Math.max(180, stats.fireCooldownMs - 28);
      stats.fireballHits = Math.min(6, stats.fireballHits + (stats.fireballLevel % 2 === 0 ? 1 : 0));
      stats.fireballSize = Math.min(27, stats.fireballSize + 1);
      stats.fireballSpeed += 24;
    }
    if (id === "meteorCore") {
      stats.meteorCoreUnlocked = true;
      stats.damage += 18;
      stats.fireballHits += 4;
      stats.fireballSize += 10;
      stats.fireballLifetimeMs += 320;
    }
    if (id === "cooldown") stats.fireCooldownMs = Math.max(170, stats.fireCooldownMs - 60);
    if (id === "projectiles") stats.projectileCount = Math.min(5, stats.projectileCount + 1);
    if (id === "arcaneRing") {
      stats.arcaneRingLevel = Math.min(8, stats.arcaneRingLevel + 1);
      if (stats.ringOrbCount === 0) {
        stats.ringOrbCount = 2;
      } else {
        stats.ringOrbCount = Math.min(7, stats.ringOrbCount + 1);
      }
      stats.ringDamage += 6;
      stats.ringRadius += 5;
      stats.ringSpinSpeed += 0.18;
    }
    if (id === "celestialHalo") {
      stats.celestialHaloUnlocked = true;
      stats.ringDamage += 14;
      stats.ringOrbCount = Math.max(stats.ringOrbCount, 7);
      stats.ringSpinSpeed += 0.45;
    }
    if (id === "chainLightning") {
      stats.lightningLevel = Math.min(8, stats.lightningLevel + 1);
      if (stats.lightningChains === 0) {
        stats.lightningChains = 4;
      } else {
        stats.lightningChains = Math.min(8, stats.lightningChains + 1);
      }
      stats.lightningDamage += 10;
      stats.lightningCooldownMs = Math.max(850, stats.lightningCooldownMs - 120);
    }
    if (id === "thunderDominion") {
      stats.thunderDominionUnlocked = true;
      stats.lightningDamage += 22;
      stats.lightningChains = Math.max(stats.lightningChains, 8);
      stats.lightningCooldownMs = Math.max(680, stats.lightningCooldownMs - 170);
    }
    if (id === "speed") stats.speed += 28;
    if (id === "magnet") stats.magnetRadius += 42;
    if (id === "maxHp") {
      stats.maxHp += 25;
      stats.hp = Math.min(stats.maxHp, stats.hp + 35);
    }
    this.pausedForUpgrade = false;
  }
}

const baseUpgradePool: UpgradeOption[] = [
  { id: "fireballSkill", title: "Fireball Mastery", description: "เพิ่มเลเวล Fireball, damage, pierce และขนาดลูกไฟ" },
  { id: "cooldown", title: "ร่ายเร็วขึ้น", description: "ลด cooldown ยิงอัตโนมัติ" },
  { id: "projectiles", title: "ลูกไฟเพิ่ม", description: "+1 projectile ต่อรอบยิง" },
  { id: "arcaneRing", title: "Arcane Ring", description: "ปลดล็อก/เพิ่มเลเวลวงแหวนเวท" },
  { id: "chainLightning", title: "Chain Lightning", description: "ปลดล็อก/เพิ่มเลเวลสายฟ้า chain" },
  { id: "speed", title: "ก้าวเงา", description: "เพิ่มความเร็วเดิน" },
  { id: "magnet", title: "แรงดูดรูน", description: "เพิ่มระยะดูด XP" },
  { id: "maxHp", title: "โลหิตนักเวท", description: "เพิ่ม HP สูงสุดและฟื้นเลือด" }
];

export function getUpgradePool(stats: PlayerStats): UpgradeOption[] {
  const pool = baseUpgradePool.filter((option) => {
    if (option.id === "fireballSkill") return stats.fireballLevel < 8;
    if (option.id === "arcaneRing") return stats.arcaneRingLevel < 8;
    if (option.id === "chainLightning") return stats.lightningLevel < 8;
    return true;
  });

  if (stats.fireballLevel >= 8 && !stats.meteorCoreUnlocked) {
    pool.push({
      id: "meteorCore",
      title: "Ultimate: Meteor Core",
      description: "Fireball ใหญ่ขึ้น ทะลุศัตรูมากขึ้น และระเบิด AOE เมื่อหมดอายุหรือชนครบ"
    });
  }

  if (stats.arcaneRingLevel >= 8 && !stats.celestialHaloUnlocked) {
    pool.push({
      id: "celestialHalo",
      title: "Ultimate: Celestial Halo",
      description: "วงแหวนเป็น 2 ชั้น ชั้นนอกหมุนกลับทิศ และโจมตีถี่ขึ้น"
    });
  }

  if (stats.lightningLevel >= 8 && !stats.thunderDominionUnlocked) {
    pool.push({
      id: "thunderDominion",
      title: "Ultimate: Thunder Dominion",
      description: "ยิงสายฟ้าพร้อมกัน 5 chain, secondary arc แรงขึ้น และมีโอกาส slow/stun"
    });
  }

  return pool;
}
