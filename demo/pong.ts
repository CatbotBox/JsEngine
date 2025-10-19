//WIP doesnt work yet

import {
    Component,
    Entity,
    EntityCommandBufferSystem,
    Resource,
    System,
    DebugWorld,
} from "../src/js_engine";
import { keyboardInput } from "../src/js_engine/input";
import {
    Camera,
    HudElement,
    RenderBounds,
} from "../src/js_engine/rendering";
import { Console2DRenderPassSystem } from "../src/js_engine/rendering/console/2d";
import {
    Ansi,
    ConsoleHudRenderPassSystem,
    ConsoleImage,
    ConsoleImageAnchor,
} from "../src/js_engine/rendering/console";
import { ScreenSize } from "../src/js_engine/rendering/screenSize";
import { LocalPosition, LocalToWorld } from "../src/js_engine/translation";
import { AverageStat } from "../src/js_engine/datatypes";
import { consoleOverride, fileLogger } from "../src/js_engine/debugging";

// Disable file logging for the demo
consoleOverride.removeConsoleEventListener(fileLogger);

// =====================================================================================
// Components / Tags
// =====================================================================================
class PlayerPaddleTag extends Component {}
class AIPaddleTag extends Component {}
class BallTag extends Component {}
class HudScoreTag extends Component {}
class HudHelpTag extends Component {}

class Velocity2D extends Component {
    constructor(public x = 0, public y = 0) { super(); }
}

class GameState extends Resource {
    constructor(
        public leftScore = 0,
        public rightScore = 0,
        public paused = false
    ) { super(); }
}

// =====================================================================================
// Game bootstrap
// =====================================================================================
class PongGame {
    private world: DebugWorld;
    private ecb = () => this.world.getOrCreateSystem(EntityCommandBufferSystem).createEntityCommandBuffer();

    constructor() {
        this.world = new DebugWorld();
        this.setupScene();
        this.installSystems();
    }

    start() {
        this.world.logSystemUpdateOrder();
        this.world.startLoop();
    }

    // ----------------------------------------
    // Scene
    // ----------------------------------------
    private setupScene() {
        const cb = this.ecb();

        // Camera
        const cam = cb.createEntity("Camera");
        cb.addComponent(cam, new Camera());
        cb.addComponent(cam, new ScreenSize());
        cb.addComponent(cam, new LocalToWorld());
        cb.addComponent(cam, new LocalPosition(0, 0));
        cb.addComponent(cam, new RenderBounds());

        // Colors / glyphs
        const paddleBg = Ansi.bgRGB(60, 60, 200);
        const aiPaddleBg = Ansi.bgRGB(200, 120, 60);
        const ballGlyph = Ansi.colors.fg.white + "●";

        // Helper to build a sprite entity
        const sprite = (
            name: string,
            lines: string[],
            pos: LocalPosition,
            extra: Component[] = []
        ) => {
            const cb2 = this.ecb();
            const e = cb2.createEntity(name);
            const img = new ConsoleImage();
            img.transparentChar = "0";
            img.image = lines;
            cb2.addComponent(e, img);
            cb2.addComponent(e, new LocalToWorld());
            cb2.addComponent(e, pos);
            for (const c of extra) cb2.addComponent(e, c);
            return e;
        };

        // Player paddle (left)
        sprite(
            "PlayerPaddle",
            [paddleBg + "0", paddleBg + "0", paddleBg + "0", paddleBg + "0"],
            new LocalPosition(-28, 0, 1),
            [new PlayerPaddleTag(), new Velocity2D(0, 0)]
        );

        // AI paddle (right)
        sprite(
            "AIPaddle",
            [aiPaddleBg + "0", aiPaddleBg + "0", aiPaddleBg + "0", aiPaddleBg + "0"],
            new LocalPosition(28, 0, 1),
            [new AIPaddleTag(), new Velocity2D(0, 0)]
        );

        // Ball
        sprite(
            "Ball",
            [ballGlyph],
            new LocalPosition(0, 0, 2),
            [new BallTag(), new Velocity2D(14, 8)]
        );

        // HUD
        this.createHUD();
    }

    private createHUD() {
        const cb = this.ecb();

        // Score HUD (top center)
        const hudScore = cb.createEntity("HUDScore");
        const scoreImg = new ConsoleImage();
        scoreImg.transparentChar = undefined;
        scoreImg.image = [Ansi.colors.fg.green + "0 : 0"];
        cb.addComponent(hudScore, scoreImg);
        cb.addComponent(hudScore, new HudElement());
        cb.addComponent(hudScore, new HudScoreTag());
        const scoreAnchor = new ConsoleImageAnchor();
        scoreAnchor.anchorPosition = "top"; // centered at top
        cb.addComponent(hudScore, scoreAnchor);

        // Help HUD (bottom-left)
        const hudHelp = cb.createEntity("HUDHelp");
        const helpImg = new ConsoleImage();
        helpImg.transparentChar = undefined;
        helpImg.image = [
            Ansi.colors.fg.cyan + "Up/Down: move   Space: pause   R: reset   Tab: HUD",
            Ansi.colors.fg.cyan + "Ball bounces off paddles & walls. First to 9 wins!",
        ];
        cb.addComponent(hudHelp, helpImg);
        cb.addComponent(hudHelp, new HudElement());
        cb.addComponent(hudHelp, new HudHelpTag());
        const helpAnchor = new ConsoleImageAnchor();
        helpAnchor.anchorPosition = "bottom-left";
        cb.addComponent(hudHelp, helpAnchor);
    }

    // ----------------------------------------
    // Systems
    // ----------------------------------------
    private installSystems() {
        this.world.ensureSystemExists(Console2DRenderPassSystem);
        this.world.ensureSystemExists(ConsoleHudRenderPassSystem);
        this.world.ensureSystemExists(PlayerPaddleInputSystem);
        this.world.ensureSystemExists(BallMovementAndCollisionsSystem);
        this.world.ensureSystemExists(AIPaddleFollowSystem);
        this.world.ensureSystemExists(HUDSystem);
        this.world.ensureSystemExists(GlobalInputSystem);
    }
}

// =====================================================================================
// Systems
// =====================================================================================
class PlayerPaddleInputSystem extends System {
    private q = this.createEntityQuery([PlayerPaddleTag, LocalPosition]);

    protected onCreate(): void {
        this.requireAnyForUpdate(this.q);

        const move = (dy: number) => {
            const state = this.world.resources.getOrCreate(GameState);
            if (state.paused) return;
            this.q.stream({ pos: LocalPosition }, { includeEntity: false }).forEach(({ pos }) => {
                pos.y += dy;
            });
        };

        keyboardInput.when({ name: "up" }, () => move(-2));
        keyboardInput.when({ name: "down" }, () => move(2));
    }

    onUpdate(): void {}
}

class AIPaddleFollowSystem extends System {
    private aiQ = this.createEntityQuery([AIPaddleTag, LocalPosition]);
    private ballQ = this.createEntityQuery([BallTag, LocalPosition, Velocity2D]);

    onUpdate(): void {
        const state = this.world.resources.getOrCreate(GameState);
        if (state.paused) return;

        const ball = this.ballQ.tryGetSingleton({ pos: LocalPosition });
        if (!ball) return;

        this.aiQ.stream({ pos: LocalPosition }, { includeEntity: false }).forEach(({ pos }) => {
            const targetY = ball.pos.y;
            const maxSpeed = 18; // units/sec
            const dt = this.world.time.deltaTime / 1000;
            const dy = Math.max(-maxSpeed * dt, Math.min(maxSpeed * dt, targetY - pos.y));
            pos.y += dy;
        });
    }
}

class BallMovementAndCollisionsSystem extends System {
    private ballQ = this.createEntityQuery([BallTag, LocalPosition, Velocity2D]);
    private playerPadQ = this.createEntityQuery([PlayerPaddleTag, LocalPosition]);
    private aiPadQ = this.createEntityQuery([AIPaddleTag, LocalPosition]);
    private screenQ = this.createEntityQuery([Camera, ScreenSize]);

    onUpdate(): void {
        const state = this.world.resources.getOrCreate(GameState);
        const ball = this.ballQ.tryGetSingleton({ pos: LocalPosition, vel: Velocity2D });
        if (!ball) return;

        const cam = this.screenQ.tryGetSingleton({ size: ScreenSize });
        const width = cam?.size.x ?? 80;
        const height = cam?.size.y ?? 24;

        const dt = this.world.time.deltaTime / 1000;
        if (!state.paused) {
            ball.pos.x += ball.vel.x * dt;
            ball.pos.y += ball.vel.y * dt;
        }

        // Walls (top/bottom)
        const top = -Math.floor(height / 2) + 1;
        const bottom = Math.floor(height / 2) - 2; // leave HUD lines
        if (ball.pos.y <= top) { ball.pos.y = top; ball.vel.y = Math.abs(ball.vel.y); }
        if (ball.pos.y >= bottom) { ball.pos.y = bottom; ball.vel.y = -Math.abs(ball.vel.y); }

        // Paddles collision — approximate with vertical line segments of height 4
        const collideWithPaddle = (paddleY: number, paddleX: number) => {
            const halfH = 1.5; // paddle half-height for collision
            const withinY = ball.pos.y >= paddleY - halfH && ball.pos.y <= paddleY + halfH + 1;
            const nearX = Math.abs(ball.pos.x - paddleX) < 1.2; // roughly touching
            if (withinY && nearX) {
                const dir = Math.sign(ball.pos.x - paddleX) || 1;
                ball.vel.x = Math.abs(ball.vel.x) * dir; // reflect horizontally
                const offset = (ball.pos.y - paddleY);
                ball.vel.y += offset * 6; // add spin based on hit position
                ball.pos.x = paddleX + dir * 1.2; // nudge out
            }
        };

        // Collide with both paddles via queries (portable across engine builds)
        this.playerPadQ.stream({ pos: LocalPosition }, { includeEntity: false }).forEach(({ pos }) => {
            collideWithPaddle(pos.y, pos.x);
        });
        this.aiPadQ.stream({ pos: LocalPosition }, { includeEntity: false }).forEach(({ pos }) => {
            collideWithPaddle(pos.y, pos.x);
        });

        // Scoring (when ball exits left/right)
        const leftOut = -Math.floor(width / 2) - 1;
        const rightOut = Math.floor(width / 2) + 1;
        if (ball.pos.x < leftOut) {
            state.rightScore += 1;
            this.resetBall(ball.pos, ball.vel, -1);
        } else if (ball.pos.x > rightOut) {
            state.leftScore += 1;
            this.resetBall(ball.pos, ball.vel, 1);
        }
    }

    private resetBall(pos: LocalPosition, vel: Velocity2D, dir: 1 | -1) {
        pos.x = 0; pos.y = 0;
        const speed = 16 + Math.random() * 8;
        vel.x = speed * dir;
        vel.y = (Math.random() * 2 - 1) * 8;
    }
}

class HUDSystem extends System {
    private hudScoreQ = this.createEntityQuery([HudElement, ConsoleImage, HudScoreTag]);
    private fps = new AverageStat(30);

    onUpdate(): void {
        const s = this.world.resources.getOrCreate(GameState);
        this.fps.add(1000 / this.world.time.deltaTime);
        const fpsStr = this.fps.getAvg().toFixed(1);

        this.hudScoreQ.stream({ img: ConsoleImage }, { includeEntity: false }).forEach(({ img }) => {
            img.image = [
                Ansi.colors.fg.green + `${s.leftScore} : ${s.rightScore}` +
                Ansi.colors.fg.yellow + `   ${fpsStr} FPS` +
                (s.paused ? Ansi.colors.fg.red + "   [PAUSED]" : "")
            ];
        });
    }
}

class GlobalInputSystem extends System {
    private hudQ = this.createEntityQuery([HudElement]);
    private hudEnabled = true;

    protected onCreate(): void {
        // Pause
        keyboardInput.when({ name: "space" }, () => {
            const s = this.world.resources.getOrCreate(GameState);
            s.paused = !s.paused;
        });

        // Reset scores and ball
        keyboardInput.when({ name: "r" }, () => {
            const s = this.world.resources.getOrCreate(GameState);
            s.leftScore = 0; s.rightScore = 0; s.paused = false;
        });

        // Toggle HUD
        keyboardInput.when({ name: "tab" }, () => {
            this.hudEnabled = !this.hudEnabled;
            const cb = this.world.getOrCreateSystem(EntityCommandBufferSystem).createEntityCommandBuffer();
            cb.setEnabledStateForQuery(this.hudQ, this.hudEnabled);
        });

        // Ctrl+C to exit cleanly
        keyboardInput.when({ name: "c", ctrl: true }, () => {
            this.world.stop();
            if (typeof process !== "undefined" && (process as any).exit) (process as any).exit(0);
        });
    }

    onUpdate(): void {}
}

// =====================================================================================
// Boot
// =====================================================================================
const game = new PongGame();
// Systems are installed in constructor

game.start();
