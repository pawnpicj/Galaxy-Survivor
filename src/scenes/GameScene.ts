import Phaser from "phaser";
import { GameState, UpgradeOption, getUpgradePool } from "../systems/GameState";

type EnemyKind = "basic" | "runner" | "brute" | "bomber" | "ranged";

type EnemySprite = Phaser.Physics.Arcade.Sprite & {
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  speed: number;
  contactTimer: number;
  ringHitTimer: number;
  shootTimer: number;
  slowTimer: number;
  isBoss: boolean;
  dashTimer: number;
  dashWindupTimer: number;
  dashActiveTimer: number;
};

type GemSprite = Phaser.Physics.Arcade.Sprite & {
  value: number;
};

type ProjectileSprite = Phaser.Physics.Arcade.Sprite & {
  hitsLeft: number;
  hitEnemies: Set<EnemySprite>;
  isMeteor: boolean;
  exploded: boolean;
  trailTimer: number;
};

type EnemyProjectileSprite = Phaser.Physics.Arcade.Sprite & {
  damage: number;
};

type RingOrbSprite = Phaser.Physics.Arcade.Sprite;

type WaveReward = {
  title: string;
  description: string;
  apply: () => void;
};

const WAVE_DURATION_MS = 60000;
const WAVE_BREAK_MS = 3000;
const BOSS_WAVES = new Set([5, 10, 15, 20, 25]);
const BOSS_DASH_INTERVAL_MS = 4300;
const BOSS_DASH_WINDUP_MS = 650;
const BOSS_DASH_ACTIVE_MS = 620;

export class GameScene extends Phaser.Scene {
  private state = new GameState();
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private enemies!: Phaser.Physics.Arcade.Group;
  private projectiles!: Phaser.Physics.Arcade.Group;
  private enemyProjectiles!: Phaser.Physics.Arcade.Group;
  private ringOrbs!: Phaser.Physics.Arcade.Group;
  private gems!: Phaser.Physics.Arcade.Group;
  private ringRotation = 0;
  private ringPulseTimer = 0;
  private arcaneRingAura?: Phaser.GameObjects.Image;
  private celestialHaloAura?: Phaser.GameObjects.Image;
  private lastShotAt = -9999;
  private lastLightningAt = -9999;
  private spawnTimer = 0;
  private isManualPaused = false;
  private speedMultiplier = 1;
  private currentWave = 1;
  private waveElapsedMs = 0;
  private waveBreakRemainingMs = 0;
  private bossSpawnedThisWave = false;
  private waveEndedMagnetActive = false;
  private waveRewardOffered = false;
  private enemyVariantsUnlocked = false;
  private hud = {
    hp: document.getElementById("hp")!,
    level: document.getElementById("level")!,
    xp: document.getElementById("xp")!,
    wave: document.getElementById("wave")!,
    waveStatus: document.getElementById("wave-status")!,
    time: document.getElementById("time")!,
    kills: document.getElementById("kills")!,
    speedButtons: Array.from(document.querySelectorAll<HTMLButtonElement>(".speed-button")),
    bossBar: document.getElementById("boss-bar")!,
    bossTitle: document.getElementById("boss-title")!,
    bossFill: document.getElementById("boss-fill")!,
    bossHp: document.getElementById("boss-hp")!,
    pauseButton: document.getElementById("pause-button") as HTMLButtonElement,
    pauseMenu: document.getElementById("pause-menu")!,
    resumeButton: document.getElementById("resume-button") as HTMLButtonElement,
    statusRestartButton: document.getElementById("status-restart-button") as HTMLButtonElement,
    statusHp: document.getElementById("status-hp")!,
    statusLevel: document.getElementById("status-level")!,
    statusXp: document.getElementById("status-xp")!,
    statusWave: document.getElementById("status-wave")!,
    statusWaveStatus: document.getElementById("status-wave-status")!,
    statusTime: document.getElementById("status-time")!,
    statusDamage: document.getElementById("status-damage")!,
    statusCooldown: document.getElementById("status-cooldown")!,
    statusProjectiles: document.getElementById("status-projectiles")!,
    statusRing: document.getElementById("status-ring")!,
    statusLightning: document.getElementById("status-lightning")!,
    statusSpeed: document.getElementById("status-speed")!,
    statusMagnet: document.getElementById("status-magnet")!,
    statusKills: document.getElementById("status-kills")!,
    skillBar: document.getElementById("skill-bar")!,
    skillFireballSlot: document.getElementById("skill-fireball-slot")!,
    skillRingSlot: document.getElementById("skill-ring-slot")!,
    skillLightningSlot: document.getElementById("skill-lightning-slot")!,
    skillFireballLevel: document.getElementById("skill-fireball-level")!,
    skillRingLevel: document.getElementById("skill-ring-level")!,
    skillLightningLevel: document.getElementById("skill-lightning-level")!,
    skillFireballIcon: document.getElementById("skill-fireball-icon")!,
    skillRingIcon: document.getElementById("skill-ring-icon")!,
    skillLightningIcon: document.getElementById("skill-lightning-icon")!,
    levelUp: document.getElementById("level-up")!,
    upgradeOptions: document.getElementById("upgrade-options")!,
    gameOver: document.getElementById("game-over")!,
    resultText: document.getElementById("result-text")!,
    restartButton: document.getElementById("restart-button") as HTMLButtonElement
  };

  constructor() {
    super("GameScene");
  }

  preload(): void {
    this.load.image("bolt", "/assets/skills/fireball.png");
    this.load.image("arcaneRingAura", "/assets/skills/arcane-ring.png");
    this.load.image("arcaneRingOrb", "/assets/skills/arcane-ring.png");
    this.load.image("thunderDominionFx", "/assets/skills/thunder-dominion.png");
    this.load.spritesheet("dragonBoss", "/assets/dragon/dragon-fly.png", {
      frameWidth: 192,
      frameHeight: 192
    });
    this.load.image("playerDragon", "/assets/player/lunar-explorer.png");
  }

  create(): void {
    this.createTextures();
    this.createAnimations();
    this.createWorld();
    this.createPlayer();
    this.createGroups();
    this.registerInput();
    this.registerCollisions();
    this.hud.restartButton.addEventListener("click", () => window.location.reload());
    this.hud.statusRestartButton.addEventListener("click", () => window.location.reload());
    this.hud.pauseButton.addEventListener("click", () => this.openPauseMenu());
    this.hud.resumeButton.addEventListener("click", () => this.closePauseMenu());
    this.hud.speedButtons.forEach((button) => {
      button.addEventListener("click", () => this.setSpeedMultiplier(Number(button.dataset.speed ?? 1)));
    });
  }

  update(time: number, delta: number): void {
    if (this.state.gameOver || this.state.pausedForUpgrade || this.isManualPaused) {
      this.player.setVelocity(0, 0);
      return;
    }

    const scaledDelta = delta * this.speedMultiplier;
    this.state.elapsedMs += scaledDelta;
    this.updateWave(scaledDelta);
    this.movePlayer();
    if (this.canSpawnWaveEnemies()) {
      this.spawnEnemies(scaledDelta);
    }
    this.updateEnemies(scaledDelta);
    this.updateRingWeapon(scaledDelta);
    this.fireAtNearestEnemy(this.state.elapsedMs);
    this.castChainLightning(this.state.elapsedMs);
    this.updateProjectileTrails(scaledDelta);
    this.updateGems();
    this.cleanupProjectiles();
    this.cleanupEnemyProjectiles();
    this.updateHud();

    if (this.state.stats.hp <= 0) {
      this.endGame();
    }
  }

  private createWorld(): void {
    const width = 3200;
    const height = 2200;
    this.physics.world.setBounds(0, 0, width, height);
    this.cameras.main.setBounds(0, 0, width, height);

    const graphics = this.add.graphics();
    graphics.fillStyle(0x070914, 1);
    graphics.fillRect(0, 0, width, height);

    for (let i = 0; i < 18; i += 1) {
      const x = Phaser.Math.Between(0, width);
      const y = Phaser.Math.Between(0, height);
      const radius = Phaser.Math.Between(120, 360);
      const color = Phaser.Utils.Array.GetRandom([0x40216d, 0x123b6d, 0x5b1f4f, 0x17395c]);
      graphics.fillStyle(color, 0.08);
      graphics.fillCircle(x, y, radius);
    }

    // graphics.lineStyle(1, 0x263246, 0.18);
    // for (let x = 0; x < width; x += 120) graphics.lineBetween(x, 0, x, height);
    // for (let y = 0; y < height; y += 120) graphics.lineBetween(0, y, width, y);

    for (let i = 0; i < 520; i += 1) {
      const starSize = Phaser.Math.FloatBetween(0.7, 2.4);
      const alpha = Phaser.Math.FloatBetween(0.35, 0.95);
      graphics.fillStyle(Phaser.Utils.Array.GetRandom([0xffffff, 0x9be7ff, 0xffd48a, 0xd7b7ff]), alpha);
      graphics.fillCircle(Phaser.Math.Between(0, width), Phaser.Math.Between(0, height), starSize);
    }

    for (let i = 0; i < 28; i += 1) {
      const x = Phaser.Math.Between(0, width);
      const y = Phaser.Math.Between(0, height);
      graphics.lineStyle(1, 0x9be7ff, Phaser.Math.FloatBetween(0.08, 0.18));
      graphics.lineBetween(x, y, x + Phaser.Math.Between(36, 120), y + Phaser.Math.Between(-18, 18));
    }
  }

  private createPlayer(): void {
    this.player = this.physics.add.sprite(1600, 1100, "playerDragon");
    this.player.setDisplaySize(78, 78);
    this.player.setCollideWorldBounds(true);
    this.player.setCircle(94, 134, 136);
    this.player.setDepth(6);
    this.tweens.add({
      targets: this.player,
      scaleY: this.player.scaleY * 1.04,
      duration: 520,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut"
    });
    this.cameras.main.startFollow(this.player, true, 0.09, 0.09);
  }

  private createGroups(): void {
    this.enemies = this.physics.add.group({ classType: Phaser.Physics.Arcade.Sprite });
    this.projectiles = this.physics.add.group({ classType: Phaser.Physics.Arcade.Sprite });
    this.enemyProjectiles = this.physics.add.group({ classType: Phaser.Physics.Arcade.Sprite });
    this.ringOrbs = this.physics.add.group({ classType: Phaser.Physics.Arcade.Sprite });
    this.gems = this.physics.add.group({ classType: Phaser.Physics.Arcade.Sprite });
  }

  private registerInput(): void {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys("W,A,S,D") as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.keyboard!.on("keydown-P", () => this.togglePauseMenu());
    this.input.keyboard!.on("keydown-ESC", () => this.togglePauseMenu());
  }

  private setSpeedMultiplier(multiplier: number): void {
    this.speedMultiplier = Phaser.Math.Clamp(multiplier, 1, 2);
    this.physics.world.timeScale = this.speedMultiplier;
    this.time.timeScale = this.speedMultiplier;
    this.hud.speedButtons.forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.speed ?? 1) === this.speedMultiplier);
    });
  }

  private registerCollisions(): void {
    this.physics.add.overlap(this.projectiles, this.enemies, (projectile, enemy) => {
      this.hitEnemy(projectile as Phaser.Physics.Arcade.Sprite, enemy as EnemySprite);
    });
    this.physics.add.overlap(this.ringOrbs, this.enemies, (_, enemy) => {
      this.hitEnemyWithRing(enemy as EnemySprite);
    });
    this.physics.add.overlap(this.player, this.gems, (_, gem) => {
      this.collectGem(gem as GemSprite);
    });
    this.physics.add.overlap(this.player, this.enemyProjectiles, (_, projectile) => {
      this.hitPlayerWithEnemyProjectile(projectile as EnemyProjectileSprite);
    });
  }

  private movePlayer(): void {
    const left = this.cursors.left.isDown || this.wasd.A.isDown;
    const right = this.cursors.right.isDown || this.wasd.D.isDown;
    const up = this.cursors.up.isDown || this.wasd.W.isDown;
    const down = this.cursors.down.isDown || this.wasd.S.isDown;
    const x = Number(right) - Number(left);
    const y = Number(down) - Number(up);
    const velocity = new Phaser.Math.Vector2(x, y).normalize().scale(this.state.stats.speed);
    this.player.setVelocity(velocity.x || 0, velocity.y || 0);
    if (velocity.x !== 0) {
      this.player.setFlipX(velocity.x > 0);
    }
  }

  private updateWave(delta: number): void {
    if (this.waveBreakRemainingMs > 0) {
      this.waveBreakRemainingMs -= delta;
      if (this.waveBreakRemainingMs <= 0) {
        this.startNextWave();
      }
      return;
    }

    if (this.waveElapsedMs < WAVE_DURATION_MS) {
      this.waveElapsedMs = Math.min(WAVE_DURATION_MS, this.waveElapsedMs + delta);
      if (this.waveElapsedMs >= WAVE_DURATION_MS) {
        this.waveEndedMagnetActive = true;
      }
      return;
    }

    if (this.enemies.countActive(true) === 0 && !this.waveRewardOffered) {
      this.waveRewardOffered = true;
      this.state.pausedForUpgrade = true;
      this.showWaveRewardChoices();
      return;
    }

    if (this.enemies.countActive(true) === 0) {
      this.waveBreakRemainingMs = WAVE_BREAK_MS;
    }
  }

  private canSpawnWaveEnemies(): boolean {
    return this.waveBreakRemainingMs <= 0 && this.waveElapsedMs < WAVE_DURATION_MS;
  }

  private startNextWave(): void {
    this.currentWave += 1;
    this.waveElapsedMs = 0;
    this.waveBreakRemainingMs = 0;
    this.spawnTimer = 0;
    this.bossSpawnedThisWave = false;
    this.waveEndedMagnetActive = false;
    this.waveRewardOffered = false;
  }

  private getWaveHpMultiplier(): number {
    return 1 + (this.currentWave - 1) * 0.5;
  }

  private spawnBossIfNeeded(): void {
    if (!BOSS_WAVES.has(this.currentWave) || this.bossSpawnedThisWave) return;

    this.bossSpawnedThisWave = true;
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const distance = Math.max(this.scale.width, this.scale.height) * 0.68;
    const boss = this.enemies.get() as EnemySprite;
    boss.enableBody(true, this.player.x + Math.cos(angle) * distance, this.player.y + Math.sin(angle) * distance, true, true);
    boss.setTexture("dragonBoss", 0);
    boss.play("dragon-fly");
    boss.kind = "brute";
    boss.maxHp = Math.round(380 * this.getWaveHpMultiplier());
    boss.hp = boss.maxHp;
    boss.speed = 58 + this.currentWave * 3;
    boss.contactTimer = 0;
    boss.ringHitTimer = 0;
    boss.shootTimer = 0;
    boss.slowTimer = 0;
    boss.isBoss = true;
    boss.dashTimer = BOSS_DASH_INTERVAL_MS;
    boss.dashWindupTimer = 0;
    boss.dashActiveTimer = 0;
    boss.setScale(0.82);
    boss.setCircle(44, 52, 58);
    boss.setDepth(5);
  }

  private spawnEnemies(delta: number): void {
    this.spawnTimer -= delta;
    this.spawnBossIfNeeded();

    const difficulty = this.getWaveHpMultiplier();
    const interval = Math.max(260, 1050 - this.waveElapsedMs / 260 - (this.currentWave - 1) * 35);
    const activeEnemies = this.enemies.countActive(true);
    const maxActiveEnemies = Math.min(120, 18 + Math.floor(this.waveElapsedMs / 4500) + (this.currentWave - 1) * 4);

    if (activeEnemies >= maxActiveEnemies) {
      this.spawnTimer = Math.max(this.spawnTimer, 120);
      return;
    }

    while (this.spawnTimer <= 0 && this.enemies.countActive(true) < maxActiveEnemies) {
      this.spawnTimer += interval;
      const enemy = this.enemies.get() as EnemySprite;
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Math.max(this.scale.width, this.scale.height) * 0.62;
      enemy.enableBody(true, this.player.x + Math.cos(angle) * distance, this.player.y + Math.sin(angle) * distance, true, true);
      this.configureEnemy(enemy, this.pickEnemyKind(), difficulty);
    }
  }

  private pickEnemyKind(): EnemyKind {
    if (!this.enemyVariantsUnlocked) {
      return Math.random() < 0.28 ? "runner" : "basic";
    }

    const roll = Math.random();
    if (roll < 0.28) return "runner";
    if (roll < 0.48) return "brute";
    if (roll < 0.68) return "bomber";
    if (roll < 0.84) return "ranged";
    return "basic";
  }

  private configureEnemy(enemy: EnemySprite, kind: EnemyKind, difficulty: number): void {
    const config: Record<EnemyKind, { texture: string; hp: number; speed: number; radius: number }> = {
      basic: { texture: "enemy", hp: 26, speed: 78, radius: 17 },
      runner: { texture: "enemyFast", hp: 12, speed: 142, radius: 13 },
      brute: { texture: "enemyBrute", hp: 78, speed: 48, radius: 25 },
      bomber: { texture: "enemyBomber", hp: 24, speed: 96, radius: 18 },
      ranged: { texture: "enemyRanged", hp: 32, speed: 66, radius: 16 }
    };
    const selected = config[kind];

    enemy.kind = kind;
    enemy.setTexture(selected.texture);
    enemy.maxHp = Math.round(selected.hp * difficulty);
    enemy.hp = enemy.maxHp;
    enemy.speed = selected.speed + difficulty * 8;
    enemy.contactTimer = 0;
    enemy.ringHitTimer = 0;
    enemy.shootTimer = Phaser.Math.Between(650, 1500);
    enemy.slowTimer = 0;
    enemy.isBoss = false;
    enemy.dashTimer = 0;
    enemy.dashWindupTimer = 0;
    enemy.dashActiveTimer = 0;
    enemy.setCircle(selected.radius);
    enemy.setDepth(4);
  }

  private updateEnemies(delta: number): void {
    this.enemies.children.each((child) => {
      const enemy = child as EnemySprite;
      if (!enemy.active) return true;

      enemy.ringHitTimer = Math.max(0, enemy.ringHitTimer - delta);
      enemy.slowTimer = Math.max(0, enemy.slowTimer - delta);
      if (enemy.isBoss) {
        this.updateBossMovement(enemy, delta);
      } else {
        this.updateEnemyMovement(enemy, delta);
      }
      const distance = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
      if (enemy.kind === "bomber" && distance < 42) {
        this.explodeEnemy(enemy);
        return true;
      }
      if (distance < 34) {
        enemy.contactTimer -= delta;
        if (enemy.contactTimer <= 0) {
          enemy.contactTimer = 520;
          this.state.stats.hp -= enemy.isBoss ? 18 : 9;
          this.cameras.main.shake(80, 0.004);
        }
      }
      return true;
    });
  }

  private updateEnemyMovement(enemy: EnemySprite, delta: number): void {
    if (enemy.kind === "ranged") {
      this.updateRangedEnemy(enemy, delta);
      return;
    }

    this.physics.moveToObject(enemy, this.player, this.getEnemyMoveSpeed(enemy));
  }

  private updateRangedEnemy(enemy: EnemySprite, delta: number): void {
    const distance = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
    const moveSpeed = this.getEnemyMoveSpeed(enemy);
    if (distance < 210) {
      const away = new Phaser.Math.Vector2(enemy.x - this.player.x, enemy.y - this.player.y).normalize().scale(moveSpeed);
      enemy.setVelocity(away.x, away.y);
    } else if (distance > 310) {
      this.physics.moveToObject(enemy, this.player, moveSpeed);
    } else {
      enemy.setVelocity(0, 0);
    }

    enemy.shootTimer -= delta;
    if (enemy.shootTimer <= 0) {
      enemy.shootTimer = Phaser.Math.Between(1700, 2400);
      this.shootEnemyProjectile(enemy);
    }
  }

  private shootEnemyProjectile(enemy: EnemySprite): void {
    const projectile = this.physics.add.sprite(enemy.x, enemy.y, "enemyShot") as EnemyProjectileSprite;
    this.enemyProjectiles.add(projectile);
    projectile.damage = 8 + Math.floor(this.currentWave / 3);
    projectile.setCircle(7);
    projectile.setDepth(6);
    this.physics.moveToObject(projectile, this.player, 360 + this.currentWave * 8);
    this.time.delayedCall(2200, () => {
      if (projectile.active) projectile.destroy();
    });
  }

  private hitPlayerWithEnemyProjectile(projectile: EnemyProjectileSprite): void {
    this.state.stats.hp -= projectile.damage;
    projectile.destroy();
    this.cameras.main.shake(70, 0.003);
  }

  private updateBossMovement(boss: EnemySprite, delta: number): void {
    if (boss.dashActiveTimer > 0) {
      boss.dashActiveTimer -= delta;
      if (boss.dashActiveTimer <= 0) {
        boss.setVelocity(0, 0);
        boss.dashTimer = BOSS_DASH_INTERVAL_MS;
      }
      return;
    }

    if (boss.dashWindupTimer > 0) {
      boss.dashWindupTimer -= delta;
      boss.setVelocity(0, 0);
      if (boss.dashWindupTimer <= 0) {
        this.physics.moveToObject(boss, this.player, (430 + this.currentWave * 8) * (boss.slowTimer > 0 ? 0.55 : 1));
        this.updateBossFacing(boss);
        boss.dashActiveTimer = BOSS_DASH_ACTIVE_MS;
        this.cameras.main.shake(90, 0.003);
      }
      return;
    }

    boss.dashTimer -= delta;
    if (boss.dashTimer <= 0) {
      boss.dashWindupTimer = BOSS_DASH_WINDUP_MS;
      boss.setTint(0xffffff);
      this.time.delayedCall(BOSS_DASH_WINDUP_MS, () => {
        if (boss.active) boss.clearTint();
      });
      return;
    }

    this.physics.moveToObject(boss, this.player, this.getEnemyMoveSpeed(boss));
    this.updateBossFacing(boss);
  }

  private updateBossFacing(boss: EnemySprite): void {
    const body = boss.body as Phaser.Physics.Arcade.Body | null;
    if (!body) return;
    boss.setFlipX(body.velocity.x > 0);
  }

  private getEnemyMoveSpeed(enemy: EnemySprite): number {
    return enemy.slowTimer > 0 ? enemy.speed * 0.45 : enemy.speed;
  }

  private updateProjectileTrails(delta: number): void {
    for (const child of this.projectiles.getChildren() as ProjectileSprite[]) {
      if (!child.active) continue;
      child.trailTimer -= delta;
      if (child.trailTimer > 0) continue;

      child.trailTimer = child.isMeteor ? 18 : 34;
      this.spawnProjectileTrail(child.x, child.y, child.isMeteor);
    }
  }

  private fireAtNearestEnemy(time: number): void {
    if (time - this.lastShotAt < this.state.stats.fireCooldownMs) return;

    const activeEnemies = this.enemies.getChildren().filter((child) => child.active) as EnemySprite[];
    if (activeEnemies.length === 0) return;

    activeEnemies.sort((a, b) => {
      const da = Phaser.Math.Distance.Squared(this.player.x, this.player.y, a.x, a.y);
      const db = Phaser.Math.Distance.Squared(this.player.x, this.player.y, b.x, b.y);
      return da - db;
    });

    this.lastShotAt = time;
    const stats = this.state.stats;
    const projectileCount = stats.projectileCount;
    const target = activeEnemies[0];
    const baseAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, target.x, target.y);
    const spreadStep = Phaser.Math.DegToRad(13);

    for (let i = 0; i < projectileCount; i += 1) {
      const spreadOffset = (i - (projectileCount - 1) / 2) * spreadStep;
      const shotAngle = baseAngle + spreadOffset;
      const spawnDistance = stats.fireballSize * (stats.meteorCoreUnlocked ? 2.1 : 1.7);
      const spawnX = this.player.x + Math.cos(shotAngle) * spawnDistance;
      const spawnY = this.player.y + Math.sin(shotAngle) * spawnDistance;
      const projectile = this.physics.add.sprite(spawnX, spawnY, "bolt") as ProjectileSprite;
      this.projectiles.add(projectile);
      projectile.hitsLeft = stats.fireballHits + (stats.meteorCoreUnlocked ? 3 : 0);
      projectile.hitEnemies = new Set();
      projectile.isMeteor = stats.meteorCoreUnlocked;
      projectile.exploded = false;
      projectile.trailTimer = 0;
      projectile.setOrigin(0.34, 0.5);
      projectile.setBlendMode(Phaser.BlendModes.ADD);
      projectile.setDisplaySize(
        stats.fireballSize * (stats.meteorCoreUnlocked ? 3.8 : 3.05),
        stats.fireballSize * (stats.meteorCoreUnlocked ? 2.35 : 1.84)
      );
      const bodyRadius = stats.fireballSize / projectile.scaleX;
      projectile.setCircle(
        bodyRadius,
        projectile.width * projectile.originX - bodyRadius,
        projectile.height * projectile.originY - bodyRadius
      );
      projectile.setDepth(8);
      projectile.setRotation(shotAngle + Math.PI);
      this.physics.velocityFromRotation(shotAngle, stats.fireballSpeed, projectile.body!.velocity);
      this.spawnMuzzleFlash(spawnX, spawnY, stats.meteorCoreUnlocked ? 0xff8f3d : 0xf4d35e);
      this.time.delayedCall(stats.fireballLifetimeMs, () => {
        if (!projectile.active) return;
        if (projectile.isMeteor) {
          this.explodeFireball(projectile);
        } else {
          projectile.destroy();
        }
      });
    }
  }

  private castChainLightning(time: number): void {
    const stats = this.state.stats;
    if (stats.lightningLevel <= 0 || time - this.lastLightningAt < stats.lightningCooldownMs) return;

    const activeEnemies = this.getActiveEnemiesSortedByDistance(this.player.x, this.player.y);
    if (activeEnemies.length === 0) return;

    this.lastLightningAt = time;
    const maxChains = Math.max(1, Math.floor(stats.lightningChains + (stats.lightningLevel - 1) * 0.25));

    if (stats.thunderDominionUnlocked) {
      const starters = activeEnemies.slice(0, 5);
      for (const target of starters) {
        this.runLightningChain({ x: this.player.x, y: this.player.y }, target, maxChains, 0.82);
      }
      return;
    }

    this.runLightningChain({ x: this.player.x, y: this.player.y }, activeEnemies[0], maxChains, 0.55);
  }

  private runLightningChain(
    start: { x: number; y: number },
    firstTarget: EnemySprite,
    maxChains: number,
    secondaryDamageMultiplier: number
  ): void {
    const stats = this.state.stats;
    const hitEnemies = new Set<EnemySprite>();
    let source = start;
    let target: EnemySprite | undefined = firstTarget;

    for (let chainIndex = 0; chainIndex <= maxChains && target; chainIndex += 1) {
      const remainingChains = Math.max(0, maxChains - chainIndex);
      const damage = Math.round(stats.lightningDamage * (1 + remainingChains * 0.15));
      this.drawLightningArc(source.x, source.y, target.x, target.y, 0x9be7ff, 2.5);
      this.damageEnemy(target, damage, 0x9be7ff);
      this.tryApplyLightningControl(target);
      hitEnemies.add(target);

      const secondary = this.findNearestEnemy(target.x, target.y, hitEnemies);
      if (secondary) {
        this.drawLightningArc(target.x, target.y, secondary.x, secondary.y, 0xd7f8ff, 1.4);
        this.damageEnemy(secondary, Math.round(damage * secondaryDamageMultiplier), 0xd7f8ff);
        this.tryApplyLightningControl(secondary);
      }

      source = { x: target.x, y: target.y };
      target = this.findNearestEnemy(source.x, source.y, hitEnemies);
    }
  }

  private tryApplyLightningControl(enemy: EnemySprite): void {
    if (!this.state.stats.thunderDominionUnlocked || !enemy.active) return;
    if (Math.random() > 0.28) return;

    const slowDuration = enemy.isBoss ? 360 : 720;
    enemy.slowTimer = Math.max(enemy.slowTimer, slowDuration);
    enemy.setTint(0x9be7ff);
    this.spawnControlRing(enemy.x, enemy.y);
    this.time.delayedCall(slowDuration + 40, () => {
      if (enemy.active && enemy.slowTimer <= 0) enemy.clearTint();
    });
  }

  private getActiveEnemiesSortedByDistance(x: number, y: number): EnemySprite[] {
    return (this.enemies.getChildren() as EnemySprite[])
      .filter((enemy) => enemy.active)
      .sort((a, b) => {
        const da = Phaser.Math.Distance.Squared(x, y, a.x, a.y);
        const db = Phaser.Math.Distance.Squared(x, y, b.x, b.y);
        return da - db;
      });
  }

  private findNearestEnemy(x: number, y: number, excluded: Set<EnemySprite>): EnemySprite | undefined {
    return this.getActiveEnemiesSortedByDistance(x, y).find((enemy) => !excluded.has(enemy));
  }

  private damageEnemy(enemy: EnemySprite, damage: number, color: number): void {
    if (!enemy.active) return;

    enemy.hp -= damage;
    this.spawnHitFlash(enemy, color);
    if (enemy.hp <= 0) {
      this.killEnemy(enemy);
    }
  }

  private drawLightningArc(x1: number, y1: number, x2: number, y2: number, color: number, width: number): void {
    const graphics = this.add.graphics().setDepth(9);
    graphics.lineStyle(width + 5, color, 0.16);
    const segments = 5;
    const points: Phaser.Math.Vector2[] = [];
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      const jitter = i === 0 || i === segments ? 0 : Phaser.Math.Between(-14, 14);
      const angle = Phaser.Math.Angle.Between(x1, y1, x2, y2) + Math.PI / 2;
      points.push(
        new Phaser.Math.Vector2(
          Phaser.Math.Linear(x1, x2, t) + Math.cos(angle) * jitter,
          Phaser.Math.Linear(y1, y2, t) + Math.sin(angle) * jitter
        )
      );
    }
    graphics.beginPath();
    graphics.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) {
      graphics.lineTo(point.x, point.y);
    }
    graphics.strokePath();
    graphics.lineStyle(width, color, 0.95);
    graphics.beginPath();
    graphics.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) {
      graphics.lineTo(point.x, point.y);
    }
    graphics.strokePath();
    this.spawnElectricSpark(x2, y2, color);
    this.tweens.add({
      targets: graphics,
      alpha: 0,
      duration: 120,
      onComplete: () => graphics.destroy()
    });
  }

  private hitEnemy(projectile: Phaser.Physics.Arcade.Sprite, enemy: EnemySprite): void {
    const magicBall = projectile as ProjectileSprite;
    if (magicBall.hitEnemies.has(enemy)) return;

    magicBall.hitEnemies.add(enemy);
    magicBall.hitsLeft -= 1;
    this.damageEnemy(enemy, this.state.stats.damage, magicBall.isMeteor ? 0xffa84d : 0xf4d35e);
    if (magicBall.hitsLeft <= 0) {
      if (magicBall.isMeteor) {
        this.explodeFireball(magicBall);
      } else {
        magicBall.destroy();
      }
    }
  }

  private explodeFireball(projectile: ProjectileSprite): void {
    if (projectile.exploded) return;

    projectile.exploded = true;
    const x = projectile.x;
    const y = projectile.y;
    const radius = 96;
    this.spawnExplosion(x, y, radius, 0xff8f3d, 0xffcf75);
    this.cameras.main.shake(65, 0.0025);

    const aoeDamage = Math.round(this.state.stats.damage * 0.85);
    for (const enemy of this.enemies.getChildren() as EnemySprite[]) {
      if (!enemy.active) continue;
      const distance = Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y);
      if (distance <= radius) {
        this.damageEnemy(enemy, aoeDamage, 0xffc76b);
      }
    }

    projectile.destroy();
  }

  private hitEnemyWithRing(enemy: EnemySprite): void {
    if (!enemy.active || enemy.ringHitTimer > 0) return;

    enemy.ringHitTimer = this.state.stats.celestialHaloUnlocked ? 130 : 260;
    enemy.hp -= this.state.stats.ringDamage;
    this.spawnHitFlash(enemy, 0x92f7ff);
    if (enemy.hp > 0) return;

    this.killEnemy(enemy);
  }

  private killEnemy(enemy: EnemySprite): void {
    if (enemy.kind === "bomber") {
      this.explodeEnemy(enemy);
      return;
    }

    const x = enemy.x;
    const y = enemy.y;
    const wasBoss = enemy.isBoss;
    this.spawnDeathBurst(x, y, wasBoss ? 0xb85cff : 0xffd166, wasBoss ? 1.7 : 1);
    enemy.disableBody(true, true);
    this.state.kills += 1;
    const gem = this.gems.get(x, y, "gem") as GemSprite;
    gem.value = wasBoss ? 20 : 1;
    gem.enableBody(true, x, y, true, true);
    gem.setCircle(9);
    gem.setDepth(3);
    this.tweens.add({
      targets: gem,
      y: y - 10,
      duration: 120,
      yoyo: true,
      ease: "Sine.easeOut"
    });

    if (wasBoss) {
      if (this.currentWave === 5) {
        this.enemyVariantsUnlocked = true;
      }
      this.forceBossRewardUpgrade();
    }
  }

  private explodeEnemy(enemy: EnemySprite): void {
    if (!enemy.active) return;

    const x = enemy.x;
    const y = enemy.y;
    enemy.disableBody(true, true);
    this.state.kills += 1;
    this.spawnExplosion(x, y, 72, 0xff7a3d, 0xffd166);
    this.cameras.main.shake(90, 0.004);

    const playerDistance = Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y);
    if (playerDistance < 86) {
      this.state.stats.hp -= 18;
    }

    const gem = this.gems.get(x, y, "gem") as GemSprite;
    gem.value = 2;
    gem.enableBody(true, x, y, true, true);
    gem.setCircle(9);
    gem.setDepth(3);
    this.tweens.add({
      targets: gem,
      y: y - 12,
      duration: 130,
      yoyo: true,
      ease: "Sine.easeOut"
    });
  }

  private forceBossRewardUpgrade(): void {
    if (this.state.gameOver) return;

    this.time.delayedCall(350, () => {
      if (this.state.gameOver || this.state.pausedForUpgrade) return;
      this.state.pausedForUpgrade = true;
      this.showUpgradeChoices("บอสถูกกำจัด");
    });
  }

  private updateRingWeapon(delta: number): void {
    const stats = this.state.stats;
    this.syncRingOrbs();
    if (stats.ringOrbCount === 0) {
      this.destroyArcaneRingAura();
      return;
    }

    this.ringRotation += (delta / 1000) * stats.ringSpinSpeed;
    this.updateArcaneRingAura(stats.ringRadius);
    const orbs = this.ringOrbs.getChildren().filter((child) => child.active) as RingOrbSprite[];
    for (let i = 0; i < orbs.length; i += 1) {
      const innerCount = stats.ringOrbCount;
      const isOuter = stats.celestialHaloUnlocked && i >= innerCount;
      const layerIndex = isOuter ? i - innerCount : i;
      const layerCount = isOuter ? orbs.length - innerCount : innerCount;
      const rotation = isOuter ? -this.ringRotation * 1.15 : this.ringRotation;
      const radius = isOuter ? stats.ringRadius + 44 : stats.ringRadius;
      const angle = rotation + (Math.PI * 2 * layerIndex) / Math.max(1, layerCount);
      orbs[i].setPosition(
        this.player.x + Math.cos(angle) * radius,
        this.player.y + Math.sin(angle) * radius
      );
      orbs[i].setRotation(isOuter ? -this.ringRotation * 1.6 : this.ringRotation * 1.8);
      orbs[i].setVelocity(0, 0);
    }

    this.ringPulseTimer -= delta;
    if (this.ringPulseTimer <= 0) {
      this.ringPulseTimer = stats.celestialHaloUnlocked ? 115 : 190;
      this.spawnRingHalo(stats.ringRadius, 0x92f7ff, 0.18);
      if (stats.celestialHaloUnlocked) {
        this.spawnRingHalo(stats.ringRadius + 44, 0xd7f8ff, 0.14);
      }
    }
  }

  private syncRingOrbs(): void {
    const stats = this.state.stats;
    const targetCount = stats.celestialHaloUnlocked ? stats.ringOrbCount * 2 : stats.ringOrbCount;
    const activeOrbs = this.ringOrbs.getChildren().filter((child) => child.active) as RingOrbSprite[];

    while (activeOrbs.length < targetCount) {
      const orb = this.physics.add.sprite(this.player.x, this.player.y, "arcaneRingOrb") as RingOrbSprite;
      orb.setBlendMode(Phaser.BlendModes.ADD);
      orb.setAlpha(0.92);
      orb.setDisplaySize(38, 38);
      const bodyRadius = 13 / orb.scaleX;
      orb.setCircle(bodyRadius, orb.width * 0.5 - bodyRadius, orb.height * 0.5 - bodyRadius);
      orb.setDepth(7);
      this.ringOrbs.add(orb);
      activeOrbs.push(orb);
    }

    while (activeOrbs.length > targetCount) {
      activeOrbs.pop()!.destroy();
    }
  }

  private updateArcaneRingAura(radius: number): void {
    const stats = this.state.stats;
    if (!this.arcaneRingAura) {
      this.arcaneRingAura = this.add.image(this.player.x, this.player.y, "arcaneRingAura");
      this.arcaneRingAura.setDepth(5);
      this.arcaneRingAura.setAlpha(0.54);
      this.arcaneRingAura.setBlendMode(Phaser.BlendModes.ADD);
    }

    const size = radius * 2.95;
    this.arcaneRingAura.setPosition(this.player.x, this.player.y);
    this.arcaneRingAura.setDisplaySize(size, size);
    this.arcaneRingAura.setRotation(this.ringRotation * 0.32);

    if (stats.celestialHaloUnlocked) {
      if (!this.celestialHaloAura) {
        this.celestialHaloAura = this.add.image(this.player.x, this.player.y, "arcaneRingAura");
        this.celestialHaloAura.setDepth(4);
        this.celestialHaloAura.setAlpha(0.34);
        this.celestialHaloAura.setTint(0xd7f8ff);
        this.celestialHaloAura.setBlendMode(Phaser.BlendModes.ADD);
      }
      this.celestialHaloAura.setPosition(this.player.x, this.player.y);
      this.celestialHaloAura.setDisplaySize(size * 1.28, size * 1.28);
      this.celestialHaloAura.setRotation(-this.ringRotation * 0.28);
    } else if (this.celestialHaloAura) {
      this.celestialHaloAura.destroy();
      this.celestialHaloAura = undefined;
    }
  }

  private destroyArcaneRingAura(): void {
    if (this.arcaneRingAura) {
      this.arcaneRingAura.destroy();
      this.arcaneRingAura = undefined;
    }
    if (this.celestialHaloAura) {
      this.celestialHaloAura.destroy();
      this.celestialHaloAura = undefined;
    }
  }

  private updateGems(): void {
    this.gems.children.each((child) => {
      const gem = child as GemSprite;
      if (!gem.active) return true;
      const distance = Phaser.Math.Distance.Between(gem.x, gem.y, this.player.x, this.player.y);
      if (this.waveEndedMagnetActive || distance < this.state.stats.magnetRadius) {
        this.physics.moveToObject(gem, this.player, this.waveEndedMagnetActive ? 620 : 330);
      }
      return true;
    });
  }

  private collectGem(gem: GemSprite): void {
    gem.disableBody(true, true);
    if (this.state.addXp(gem.value)) {
      this.showUpgradeChoices();
    }
    this.updateHud();
  }

  private showUpgradeChoices(title = "เลือกพลังใหม่"): void {
    this.physics.pause();
    this.isManualPaused = false;
    this.hud.pauseMenu.classList.add("hidden");
    this.hud.upgradeOptions.replaceChildren();
    const shuffled = Phaser.Utils.Array.Shuffle([...getUpgradePool(this.state.stats)]).slice(0, 3);
    const titleEl = this.hud.levelUp.querySelector("h1");
    if (titleEl) titleEl.textContent = title;

    for (const option of shuffled) {
      const button = document.createElement("button");
      button.className = "upgrade-card";
      button.innerHTML = `<strong>${option.title}</strong><span>${option.description}</span>`;
      button.addEventListener("click", () => this.chooseUpgrade(option));
      this.hud.upgradeOptions.appendChild(button);
    }
    this.hud.levelUp.classList.remove("hidden");
  }

  private showWaveRewardChoices(): void {
    this.physics.pause();
    this.isManualPaused = false;
    this.hud.pauseMenu.classList.add("hidden");
    this.hud.upgradeOptions.replaceChildren();

    const titleEl = this.hud.levelUp.querySelector("h1");
    if (titleEl) titleEl.textContent = "รางวัลจบ Wave";

    const rewards = Phaser.Utils.Array.Shuffle(this.getWaveRewardPool()).slice(0, 3);
    for (const reward of rewards) {
      const button = document.createElement("button");
      button.className = "upgrade-card";
      button.innerHTML = `<strong>${reward.title}</strong><span>${reward.description}</span>`;
      button.addEventListener("click", () => this.chooseWaveReward(reward));
      this.hud.upgradeOptions.appendChild(button);
    }

    this.hud.levelUp.classList.remove("hidden");
  }

  private getWaveRewardPool(): WaveReward[] {
    const stats = this.state.stats;
    const rewards: WaveReward[] = [
      {
        title: "ฟื้นพลัง",
        description: "ฟื้น HP 25% ของ HP สูงสุด",
        apply: () => {
          stats.hp = Math.min(stats.maxHp, stats.hp + Math.ceil(stats.maxHp * 0.25));
        }
      },
      {
        title: "ไฟแรงชั่วนิรันดร์",
        description: "+10 damage ให้ fireball",
        apply: () => {
          stats.damage += 10;
        }
      },
      {
        title: "เท้าเบา",
        description: "+20 move speed",
        apply: () => {
          stats.speed += 20;
        }
      },
      {
        title: "แรงดูด XP",
        description: "+35 magnet radius",
        apply: () => {
          stats.magnetRadius += 35;
        }
      },
      {
        title: "ร่ายไว",
        description: "-35ms fireball cooldown",
        apply: () => {
          stats.fireCooldownMs = Math.max(170, stats.fireCooldownMs - 35);
        }
      },
      {
        title: "รูนประสบการณ์",
        description: "เติม XP 40% ของหลอดปัจจุบัน",
        apply: () => {
          stats.xp = Math.min(stats.xpToNext - 1, stats.xp + Math.ceil(stats.xpToNext * 0.4));
        }
      }
    ];

    if (stats.ringOrbCount > 0) {
      rewards.push({
        title: "คมวงแหวน",
        description: "+8 ring damage",
        apply: () => {
          stats.ringDamage += 8;
        }
      });
    }

    if (stats.lightningLevel > 0) {
      rewards.push({
        title: "ประจุสายฟ้า",
        description: "+8 lightning damage",
        apply: () => {
          stats.lightningDamage += 8;
        }
      });
    }

    return rewards;
  }

  private chooseWaveReward(reward: WaveReward): void {
    reward.apply();
    this.hud.levelUp.classList.add("hidden");
    this.state.pausedForUpgrade = false;
    this.waveBreakRemainingMs = WAVE_BREAK_MS;
    this.physics.resume();
    this.updateHud();
  }

  private chooseUpgrade(option: UpgradeOption): void {
    this.state.applyUpgrade(option.id);
    this.hud.levelUp.classList.add("hidden");
    this.physics.resume();
    this.spawnPlayerBurst(this.getUpgradeEffectColor(option.id), option.id.includes("meteor") || option.id.includes("Halo") || option.id.includes("Dominion"));
    this.updateHud();
  }

  private getUpgradeEffectColor(id: UpgradeOption["id"]): number {
    if (id === "arcaneRing" || id === "celestialHalo") return 0x92f7ff;
    if (id === "chainLightning" || id === "thunderDominion") return 0xd7f8ff;
    if (id === "meteorCore" || id === "fireballSkill" || id === "projectiles" || id === "cooldown") return 0xffb84d;
    if (id === "maxHp") return 0x8cff98;
    return 0xf4d35e;
  }

  private spawnProjectileTrail(x: number, y: number, isMeteor: boolean): void {
    const color = isMeteor ? 0xff8f3d : 0xf4d35e;
    const glow = this.add.circle(x, y, isMeteor ? 15 : 9, color, isMeteor ? 0.26 : 0.18).setDepth(6);
    this.tweens.add({
      targets: glow,
      scale: isMeteor ? 0.2 : 0.12,
      alpha: 0,
      duration: isMeteor ? 190 : 145,
      ease: "Sine.easeOut",
      onComplete: () => glow.destroy()
    });
  }

  private spawnMuzzleFlash(x: number, y: number, color: number): void {
    const flash = this.add.circle(x, y, 18, color, 0.24).setDepth(7);
    this.tweens.add({
      targets: flash,
      scale: 1.8,
      alpha: 0,
      duration: 120,
      ease: "Cubic.easeOut",
      onComplete: () => flash.destroy()
    });
  }

  private spawnHitFlash(enemy: EnemySprite, color: number): void {
    const flash = this.add.circle(enemy.x, enemy.y, enemy.isBoss ? 34 : 22, color, 0.18).setDepth(7);
    enemy.setTint(color);
    this.tweens.add({
      targets: flash,
      scale: 1.8,
      alpha: 0,
      duration: 120,
      ease: "Sine.easeOut",
      onComplete: () => flash.destroy()
    });
    this.time.delayedCall(70, () => {
      if (enemy.active && enemy.slowTimer <= 0) enemy.clearTint();
    });
  }

  private spawnExplosion(x: number, y: number, radius: number, color: number, sparkColor: number): void {
    const blast = this.add.circle(x, y, radius * 0.2, color, 0.26).setDepth(7);
    const ring = this.add.circle(x, y, radius * 0.35).setDepth(8);
    ring.setStrokeStyle(4, sparkColor, 0.75);
    this.tweens.add({
      targets: blast,
      scale: 5,
      alpha: 0,
      duration: 260,
      ease: "Cubic.easeOut",
      onComplete: () => blast.destroy()
    });
    this.tweens.add({
      targets: ring,
      scale: 2.3,
      alpha: 0,
      duration: 300,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy()
    });
    this.spawnSparkBurst(x, y, sparkColor, 12, radius * 0.72);
  }

  private spawnDeathBurst(x: number, y: number, color: number, scale: number): void {
    this.spawnSparkBurst(x, y, color, Math.round(8 * scale), 34 * scale);
    const pop = this.add.circle(x, y, 12 * scale, color, 0.22).setDepth(7);
    this.tweens.add({
      targets: pop,
      scale: 2.4,
      alpha: 0,
      duration: 170,
      ease: "Back.easeOut",
      onComplete: () => pop.destroy()
    });
  }

  private spawnSparkBurst(x: number, y: number, color: number, count: number, distance: number): void {
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + Phaser.Math.FloatBetween(-0.18, 0.18);
      const length = Phaser.Math.Between(distance * 0.45, distance);
      const spark = this.add.circle(x, y, Phaser.Math.Between(2, 4), color, 0.72).setDepth(9);
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(angle) * length,
        y: y + Math.sin(angle) * length,
        alpha: 0,
        scale: 0.1,
        duration: Phaser.Math.Between(170, 280),
        ease: "Cubic.easeOut",
        onComplete: () => spark.destroy()
      });
    }
  }

  private spawnRingHalo(radius: number, color: number, alpha: number): void {
    const ring = this.add.circle(this.player.x, this.player.y, radius).setDepth(6);
    ring.setStrokeStyle(2, color, alpha);
    this.tweens.add({
      targets: ring,
      scale: 1.04,
      alpha: 0,
      duration: 180,
      ease: "Sine.easeOut",
      onComplete: () => ring.destroy()
    });
  }

  private spawnElectricSpark(x: number, y: number, color: number): void {
    const flash = this.add.circle(x, y, 16, color, 0.22).setDepth(9);
    this.tweens.add({
      targets: flash,
      scale: 2,
      alpha: 0,
      duration: 130,
      ease: "Sine.easeOut",
      onComplete: () => flash.destroy()
    });

    const thunderFx = this.add.image(x, y, "thunderDominionFx").setDepth(8);
    thunderFx.setBlendMode(Phaser.BlendModes.ADD);
    thunderFx.setAlpha(this.state.stats.thunderDominionUnlocked ? 0.58 : 0.28);
    thunderFx.setRotation(Phaser.Math.FloatBetween(-0.75, 0.75));
    thunderFx.setDisplaySize(
      this.state.stats.thunderDominionUnlocked ? 142 : 82,
      this.state.stats.thunderDominionUnlocked ? 104 : 60
    );
    this.tweens.add({
      targets: thunderFx,
      scaleX: thunderFx.scaleX * 1.18,
      scaleY: thunderFx.scaleY * 1.18,
      alpha: 0,
      duration: this.state.stats.thunderDominionUnlocked ? 220 : 145,
      ease: "Cubic.easeOut",
      onComplete: () => thunderFx.destroy()
    });
  }

  private spawnControlRing(x: number, y: number): void {
    const ring = this.add.circle(x, y, 24).setDepth(8);
    ring.setStrokeStyle(3, 0x9be7ff, 0.62);
    this.tweens.add({
      targets: ring,
      scale: 1.8,
      alpha: 0,
      duration: 240,
      ease: "Sine.easeOut",
      onComplete: () => ring.destroy()
    });
  }

  private spawnPlayerBurst(color: number, isUltimate: boolean): void {
    const radius = isUltimate ? 90 : 54;
    const ring = this.add.circle(this.player.x, this.player.y, radius).setDepth(10);
    ring.setStrokeStyle(isUltimate ? 5 : 3, color, isUltimate ? 0.9 : 0.62);
    this.tweens.add({
      targets: ring,
      scale: isUltimate ? 2.3 : 1.7,
      alpha: 0,
      duration: isUltimate ? 520 : 280,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy()
    });
    this.spawnSparkBurst(this.player.x, this.player.y, color, isUltimate ? 22 : 10, isUltimate ? 110 : 55);
    if (isUltimate) this.cameras.main.shake(130, 0.003);
  }

  private cleanupProjectiles(): void {
    this.projectiles.children.each((child) => {
      const projectile = child as Phaser.Physics.Arcade.Sprite;
      if (!projectile.active) return true;
      const bounds = this.physics.world.bounds;
      if (!bounds.contains(projectile.x, projectile.y)) {
        projectile.destroy();
      }
      return true;
    });
  }

  private cleanupEnemyProjectiles(): void {
    this.enemyProjectiles.children.each((child) => {
      const projectile = child as Phaser.Physics.Arcade.Sprite;
      if (!projectile.active) return true;
      const bounds = this.physics.world.bounds;
      if (!bounds.contains(projectile.x, projectile.y)) {
        projectile.destroy();
      }
      return true;
    });
  }

  private updateHud(): void {
    const seconds = Math.floor(this.state.elapsedMs / 1000);
    this.hud.hp.textContent = `${Math.max(0, Math.ceil(this.state.stats.hp))}/${this.state.stats.maxHp}`;
    this.hud.level.textContent = String(this.state.stats.level);
    this.hud.xp.textContent = `${this.state.stats.xp}/${this.state.stats.xpToNext}`;
    this.hud.wave.textContent = String(this.currentWave);
    this.hud.waveStatus.textContent = this.getWaveStatusText();
    this.hud.time.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    this.hud.kills.textContent = String(this.state.kills);
    this.updateSkillHud();
    this.updateBossBar();
  }

  private updateSkillHud(): void {
    const stats = this.state.stats;
    const showFireball = stats.fireballLevel > 1 || stats.meteorCoreUnlocked;
    const showRing = stats.arcaneRingLevel > 0 || stats.celestialHaloUnlocked;
    const showLightning = stats.lightningLevel > 0 || stats.thunderDominionUnlocked;

    this.hud.skillBar.classList.toggle("hidden", !showFireball && !showRing && !showLightning);
    this.hud.skillFireballSlot.classList.toggle("hidden", !showFireball);
    this.hud.skillRingSlot.classList.toggle("hidden", !showRing);
    this.hud.skillLightningSlot.classList.toggle("hidden", !showLightning);

    this.hud.skillFireballLevel.textContent = stats.meteorCoreUnlocked ? "ULT" : `Lv ${stats.fireballLevel}`;
    this.hud.skillRingLevel.textContent =
      stats.arcaneRingLevel === 0 ? "Locked" : stats.celestialHaloUnlocked ? "ULT" : `Lv ${stats.arcaneRingLevel}`;
    this.hud.skillLightningLevel.textContent =
      stats.lightningLevel === 0 ? "Locked" : stats.thunderDominionUnlocked ? "ULT" : `Lv ${stats.lightningLevel}`;
    this.hud.skillFireballIcon.classList.toggle("ultimate", stats.meteorCoreUnlocked);
    this.hud.skillRingIcon.classList.toggle("locked", stats.arcaneRingLevel === 0);
    this.hud.skillRingIcon.classList.toggle("ultimate", stats.celestialHaloUnlocked);
    this.hud.skillLightningIcon.classList.toggle("locked", stats.lightningLevel === 0);
    this.hud.skillLightningIcon.classList.toggle("ultimate", stats.thunderDominionUnlocked);
  }

  private updateBossBar(): void {
    const boss = this.getActiveBoss();
    if (!boss) {
      this.hud.bossBar.classList.add("hidden");
      return;
    }

    const hp = Math.max(0, Math.ceil(boss.hp));
    const maxHp = Math.max(1, boss.maxHp);
    const pct = Phaser.Math.Clamp(hp / maxHp, 0, 1);
    this.hud.bossTitle.textContent = `Wave ${this.currentWave} Boss`;
    this.hud.bossHp.textContent = `${hp}/${maxHp}`;
    this.hud.bossFill.style.width = `${pct * 100}%`;
    this.hud.bossBar.classList.remove("hidden");
  }

  private getActiveBoss(): EnemySprite | undefined {
    return (this.enemies.getChildren() as EnemySprite[]).find((enemy) => enemy.active && enemy.isBoss);
  }

  private endGame(): void {
    this.state.gameOver = true;
    this.physics.pause();
    this.hud.resultText.textContent = `อยู่รอดได้ ${this.hud.time.textContent} | กำจัดศัตรู ${this.state.kills} ตัว | เลเวล ${this.state.stats.level}`;
    this.hud.gameOver.classList.remove("hidden");
  }

  private togglePauseMenu(): void {
    if (this.state.gameOver || this.state.pausedForUpgrade) return;
    if (this.isManualPaused) {
      this.closePauseMenu();
    } else {
      this.openPauseMenu();
    }
  }

  private openPauseMenu(): void {
    if (this.state.gameOver || this.state.pausedForUpgrade) return;
    this.isManualPaused = true;
    this.player.setVelocity(0, 0);
    this.physics.pause();
    this.updateStatusPanel();
    this.hud.pauseMenu.classList.remove("hidden");
  }

  private closePauseMenu(): void {
    if (!this.isManualPaused) return;
    this.isManualPaused = false;
    this.hud.pauseMenu.classList.add("hidden");
    this.physics.resume();
  }

  private updateStatusPanel(): void {
    const stats = this.state.stats;
    this.hud.statusHp.textContent = `${Math.max(0, Math.ceil(stats.hp))}/${stats.maxHp}`;
    this.hud.statusLevel.textContent = String(stats.level);
    this.hud.statusXp.textContent = `${stats.xp}/${stats.xpToNext}`;
    this.hud.statusWave.textContent = String(this.currentWave);
    this.hud.statusWaveStatus.textContent = this.getWaveStatusText();
    this.hud.statusTime.textContent = this.formatElapsed();
    this.hud.statusDamage.textContent = String(stats.damage);
    this.hud.statusCooldown.textContent = `${stats.fireCooldownMs}ms`;
    this.hud.statusProjectiles.textContent = String(stats.projectileCount);
    this.hud.statusRing.textContent =
      stats.ringOrbCount === 0
        ? "Locked"
        : `${stats.celestialHaloUnlocked ? "ULT " : ""}Lv ${stats.arcaneRingLevel} / ${stats.ringOrbCount} orbs`;
    this.hud.statusLightning.textContent =
      stats.lightningLevel === 0
        ? "Locked"
        : `${stats.thunderDominionUnlocked ? "ULT " : ""}Lv ${stats.lightningLevel} / ${Math.floor(stats.lightningChains)} chains`;
    this.hud.statusSpeed.textContent = String(stats.speed);
    this.hud.statusMagnet.textContent = String(stats.magnetRadius);
    this.hud.statusKills.textContent = String(this.state.kills);
  }

  private formatElapsed(): string {
    const seconds = Math.floor(this.state.elapsedMs / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }

  private getWaveStatusText(): string {
    if (this.waveBreakRemainingMs > 0) {
      return `พัก ${Math.ceil(this.waveBreakRemainingMs / 1000)}s`;
    }

    if (this.waveElapsedMs >= WAVE_DURATION_MS) {
      return `เคลียร์ ${this.enemies.countActive(true)}`;
    }

    return this.formatMs(WAVE_DURATION_MS - this.waveElapsedMs);
  }

  private formatMs(ms: number): string {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }

  private createTextures(): void {
    this.makeCircleTexture("enemy", 0xf25f5c, 18, 0x461719);
    this.makeCircleTexture("enemyFast", 0xffb84d, 14, 0x4d2c0b);
    this.makeCircleTexture("enemyBrute", 0x8b5cf6, 26, 0x25123f);
    this.makeCircleTexture("enemyBomber", 0xff6b35, 19, 0x4d1c0a);
    this.makeCircleTexture("enemyRanged", 0x5cd85c, 17, 0x123f19);
    this.makeCircleTexture("boss", 0xb85cff, 36, 0xffffff);
    if (!this.textures.exists("bolt")) {
      this.makeFireballTexture("bolt");
    }
    this.makeCircleTexture("enemyShot", 0xff5c8a, 8, 0xffffff);
    this.makeDiamondTexture("gem", 0x8cff98);
  }

  private createAnimations(): void {
    if (this.anims.exists("dragon-fly")) return;

    this.anims.create({
      key: "dragon-fly",
      frames: this.anims.generateFrameNumbers("dragonBoss", { start: 0, end: 4 }),
      frameRate: 8,
      repeat: -1
    });
  }

  private makeCircleTexture(key: string, fill: number, radius: number, stroke: number): void {
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(fill, 1);
    graphics.fillCircle(radius + 3, radius + 3, radius);
    graphics.lineStyle(3, stroke, 0.9);
    graphics.strokeCircle(radius + 3, radius + 3, radius - 1);
    graphics.generateTexture(key, radius * 2 + 6, radius * 2 + 6);
    graphics.destroy();
  }

  private makeFireballTexture(key: string): void {
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(0xff7a3d, 0.55);
    graphics.fillPoints([
      new Phaser.Geom.Point(2, 23),
      new Phaser.Geom.Point(15, 8),
      new Phaser.Geom.Point(20, 18),
      new Phaser.Geom.Point(42, 6),
      new Phaser.Geom.Point(58, 23),
      new Phaser.Geom.Point(42, 40),
      new Phaser.Geom.Point(20, 28),
      new Phaser.Geom.Point(15, 38)
    ]);
    graphics.fillStyle(0xf4d35e, 1);
    graphics.fillEllipse(36, 23, 32, 24);
    graphics.fillStyle(0xfff0a3, 0.95);
    graphics.fillEllipse(42, 20, 17, 12);
    graphics.lineStyle(3, 0xffffff, 0.85);
    graphics.strokeEllipse(36, 23, 32, 24);
    graphics.generateTexture(key, 60, 46);
    graphics.destroy();
  }

  private makeDiamondTexture(key: string, fill: number): void {
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(fill, 1);
    graphics.fillPoints([
      new Phaser.Geom.Point(12, 0),
      new Phaser.Geom.Point(24, 12),
      new Phaser.Geom.Point(12, 24),
      new Phaser.Geom.Point(0, 12)
    ]);
    graphics.generateTexture(key, 24, 24);
    graphics.destroy();
  }
}
