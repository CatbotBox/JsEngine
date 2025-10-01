import {
    Component,
    Entity,
    EntityCommandBufferSystem, Resource,
    System,
    DebugWorld,
} from "../src/js_engine";
import {keyboardInput} from "../src/js_engine/input";
import {
    Camera,
    HudElement,
    RenderBounds,
    RenderingSystemGroup,
} from "../src/js_engine/rendering";
import {Console2DRenderPassSystem} from "../src/js_engine/rendering/console/2d";
import {
    Ansi,
    ConsoleHudRenderPassSystem,
    ConsoleImage,
    ConsoleImageAnchor,
} from "../src/js_engine/rendering/console";
import {ScreenSize} from "../src/js_engine/rendering/screenSize";
import {LocalPosition, LocalToWorld, Parent} from "../src/js_engine/translation";
import {AverageStat} from "../src/js_engine/datatypes";
import {consoleOverride,fileLogger} from "../src/js_engine/debugging";

// disable file logging
consoleOverride.removeConsoleEventListener(fileLogger)

// =====================================================================================
// Components / Tags
// =====================================================================================
class PlayerTag extends Component {
}

class EnemyTag extends Component {
}

class StarTag extends Component {
}

class HudScoreTag extends Component {
}

class HudHelpTag extends Component {
}

class Velocity2D extends Component {
    constructor(public x = 0, public y = 0) {
        super();
    }
}

class Alive extends Component {
    constructor(public value = true) {
        super();
    }
}

class GameState extends Resource {
    constructor(
        public score = 0,
        public best = 0,
        public gameOver = false
    ) {
        super();
    }
}

class StarSpawnerState extends Resource {
    constructor(public lastSpawnSeconds = 0) {
        super();
    }
}

// =====================================================================================
// Game bootstrap encapsulated in a class (no globals)
// =====================================================================================
class Game {
    private world: DebugWorld;
    private ecb = () => this.world.getOrCreateSystem(EntityCommandBufferSystem).createEntityCommandBuffer();

    constructor() {
        this.world = new DebugWorld();
        this.setupScene();
        this.installSystems();
    }

    start() {
        this.world.logSystemUpdateOrder()
        this.world.startLoop();
    }

    // ----------------------------------------
    // Scene setup helpers
    // ----------------------------------------
    private setupScene() {
        const commandBuffer = this.ecb();

        // Camera rig
        {
            const cameraEntity = commandBuffer.createEntity("Camera");
            commandBuffer.addComponent(cameraEntity, new Camera());
            commandBuffer.addComponent(cameraEntity, new ScreenSize());
            commandBuffer.addComponent(cameraEntity, new LocalToWorld());
            commandBuffer.addComponent(cameraEntity, new LocalPosition(0, 0));
            commandBuffer.addComponent(cameraEntity, new RenderBounds());
        }

        this.world.resources.getOrCreate(StarSpawnerState);
        this.world.resources.getOrCreate(GameState);

        // Sprites
        const playerBackground = Ansi.bgRGB(40, 160, 255);
        const enemyBackground = Ansi.bgRGB(200, 40, 40);
        const starGlyph = Ansi.colors.fg.yellow + "*";

        const createSprite = (
            name: string,
            imageLines: string[],
            position: LocalPosition,
            extra: Component[] = [],
            parent?: Entity
        ) => {
            const cb = this.ecb();
            const entity = cb.createEntity(name);
            const consoleImage = new ConsoleImage();
            consoleImage.transparentChar = "0";
            consoleImage.image = imageLines;
            cb.addComponent(entity, consoleImage);
            cb.addComponent(entity, new LocalToWorld());
            cb.addComponent(entity, position);
            if (parent) cb.addComponent(entity, new Parent(parent));
            for (const c of extra) cb.addComponent(entity, c);
            return entity;
        };

        // Player (cross)
        createSprite(
            "Player",
            [playerBackground + "0 0", playerBackground + "   ", playerBackground + "0 0"],
            new LocalPosition(0, 0, 1),
            [new PlayerTag(), new Velocity2D()]
        );

        // Enemy (square)
        createSprite(
            "Enemy",
            [enemyBackground + "   ", enemyBackground + "   ", enemyBackground + "   "],
            new LocalPosition(12, -6, 2),
            [new EnemyTag(), new Velocity2D()]
        );

        // Initial stars
        for (let i = 0; i < 25; i++) {
            this.spawnStar((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 30, starGlyph);
        }

        // HUD
        this.createHUD();
    }

    private createHUD() {
        const commandBuffer = this.ecb();

        // Score HUD
        {
            const hudScoreEntity = commandBuffer.createEntity("HUDScore");
            const hudScoreImage = new ConsoleImage();
            hudScoreImage.transparentChar = undefined;
            hudScoreImage.image = [Ansi.colors.fg.green + "Score: 0  Best: 0"];
            commandBuffer.addComponent(hudScoreEntity, hudScoreImage);
            commandBuffer.addComponent(hudScoreEntity, new HudElement());
            commandBuffer.addComponent(hudScoreEntity, new HudScoreTag());
            const hudScoreAnchor = new ConsoleImageAnchor();
            hudScoreAnchor.anchorPosition = "top-left";
            commandBuffer.addComponent(hudScoreEntity, hudScoreAnchor);
        }

        // Help HUD
        {
            const hudHelpEntity = commandBuffer.createEntity("HUDHelp");
            const hudHelpImage = new ConsoleImage();
            hudHelpImage.transparentChar = undefined;
            hudHelpImage.image = [
                Ansi.colors.fg.cyan + "Arrows: move  Space: ring  R: restart  Tab: HUD",
                Ansi.colors.fg.cyan + "WASD: camera  Enter: view console",
            ];
            commandBuffer.addComponent(hudHelpEntity, hudHelpImage);
            commandBuffer.addComponent(hudHelpEntity, new HudElement());
            commandBuffer.addComponent(hudHelpEntity, new HudHelpTag());
            const hudHelpAnchor = new ConsoleImageAnchor();
            hudHelpAnchor.anchorPosition = "bottom-left";
            commandBuffer.addComponent(hudHelpEntity, hudHelpAnchor);
        }
    }

    private spawnStar(x: number, y: number, glyph?: string) {
        const cb = this.ecb();
        const starGlyph = glyph ?? Ansi.colors.fg.yellow + "*";
        const entity = cb.createEntity("Star");
        const img = new ConsoleImage();
        img.image = [starGlyph];
        img.transparentChar = undefined;
        cb.addComponent(entity, img);
        cb.addComponent(entity, new LocalToWorld());
        cb.addComponent(entity, new LocalPosition(x, y));
        cb.addComponent(entity, new StarTag());
        cb.addComponent(entity, new Alive(true));
    }

    // ----------------------------------------
    // Systems
    // ----------------------------------------
    private installSystems() {
        this.world.ensureSystemExists(Console2DRenderPassSystem);
        this.world.ensureSystemExists(ConsoleHudRenderPassSystem);
        this.world.ensureSystemExists(PlayerInputSystem);
        this.world.ensureSystemExists(EnemyChaseSystem);
        this.world.ensureSystemExists(StarLogicSystem);
        this.world.ensureSystemExists(HudSystem);
        this.world.ensureSystemExists(GlobalInputSystem);
    }
}

// =====================================================================================
// Systems — rely only on ECS state/queries
// =====================================================================================
class PlayerInputSystem extends System {
    private playerQuery = this.createEntityQuery([PlayerTag, LocalPosition]);
    private cameraQuery = this.createEntityQuery([Camera, LocalPosition]);

    protected onCreate(): void {
        this.requireAnyForUpdate(this.playerQuery);

        const translate = (dx: number, dy: number) => {
            const state = this.world.resources.getOrCreate(GameState)
            if (state.gameOver) return;
            this.playerQuery.stream({position: LocalPosition}, {includeEntity: false}).forEach(({position}) => {
                position.x += dx;
                position.y += dy;
            });
        };

        keyboardInput.when({name: "up"}, () => translate(0, -1));
        keyboardInput.when({name: "down"}, () => translate(0, 1));
        keyboardInput.when({name: "left"}, () => translate(-1, 0));
        keyboardInput.when({name: "right"}, () => translate(1, 0));

        // Camera pan
        const pan = (dx: number, dy: number) => {
            this.cameraQuery.stream({position: LocalPosition}, {includeEntity: false}).forEach(({position}) => {
                position.x += dx;
                position.y += dy;
            });
        };
        keyboardInput.when({name: "w"}, () => pan(0, -1));
        keyboardInput.when({name: "s"}, () => pan(0, 1));
        keyboardInput.when({name: "a"}, () => pan(-1, 0));
        keyboardInput.when({name: "d"}, () => pan(1, 0));
    }

    onUpdate(): void {
    }
}

class EnemyChaseSystem extends System {
    private enemyQuery = this.createEntityQuery([EnemyTag, LocalPosition]);
    private playerQuery = this.createEntityQuery([PlayerTag, LocalPosition]);

    onUpdate(): void {
        const state = this.world.resources.getOrCreate(GameState)
        if (state.gameOver) return;

        const player = this.playerQuery.tryGetSingleton({position: LocalPosition});
        if (!player) return;

        const dt = this.world.time.deltaTime / 1000;
        const speed = 6;

        this.enemyQuery
            .stream({position: LocalPosition}, {filterBlackList: [LocalToWorld]})
            .forEach(({position}) => {
                const dx = player.position.x - position.x;
                const dy = player.position.y - position.y;
                const dist = Math.hypot(dx, dy) || 1;
                position.x += (dx / dist) * speed * dt;
                position.y += (dy / dist) * speed * dt;
            });
    }
}

class StarLogicSystem extends System {
    private playerQuery = this.createEntityQuery([PlayerTag, LocalPosition]);
    private starQuery = this.createEntityQuery([StarTag, LocalPosition, Alive, ConsoleImage]);
    private enemyQuery = this.createEntityQuery([EnemyTag, LocalPosition]);


    onUpdate(): void {
        const state = this.world.resources.getOrCreate(GameState);
        const spawner = this.world.resources.getOrCreate(StarSpawnerState);
        if (!state || !spawner) return;

        const dtSeconds = this.world.time.deltaTime / 1000;
        spawner.lastSpawnSeconds += dtSeconds;

        const player = this.playerQuery.tryGetSingleton({position: LocalPosition});
        if (!player) return;

        const px = player.position.x;
        const py = player.position.y;

        // Collect: mark Alive=false and clear image when close
        this.starQuery
            .stream({position: LocalPosition, alive: Alive, image: ConsoleImage})
            .forEach(({position, alive, image}) => {
                if (!alive.value) return;
                const distance = Math.hypot(px - position.x, py - position.y);
                if (distance < 2) {
                    alive.value = false;
                    image.image = [""]; // hide
                    state.score++;
                    if (state.score > state.best) state.best = state.score;
                }
            });

        // Enemy catch check (use first enemy; extend to many if needed)
        const enemy = this.enemyQuery.tryGetSingleton({position: LocalPosition});
        if (!state.gameOver && enemy) {
            if (Math.hypot(px - enemy.position.x, py - enemy.position.y) < 2) {
                state.gameOver = true;
            }
        }

        // Ambient spawns if below cap
        if (spawner.lastSpawnSeconds > 1.25 && this.starQuery.entityCount() < 150) {
            spawner.lastSpawnSeconds = 0;
            for (let i = 0; i < 3; i++) this.spawnAround(px, py);
        }
    }

    private spawnAround(px: number, py: number) {
        const radius = 20;
        const x = px + (Math.random() - 0.5) * (2 * radius);
        const y = py + (Math.random() - 0.5) * radius;
        const starGlyph = Ansi.colors.fg.yellow + "*";

        const cb = this.world.getOrCreateSystem(EntityCommandBufferSystem).createEntityCommandBuffer();
        const entity = cb.createEntity("Star");
        const img = new ConsoleImage();
        img.image = [starGlyph];
        cb.addComponent(entity, img);
        cb.addComponent(entity, new LocalToWorld());
        cb.addComponent(entity, new LocalPosition(x, y));
        cb.addComponent(entity, new StarTag());
        cb.addComponent(entity, new Alive(true));
    }
}

class HudSystem extends System {
    private hudScoreQuery = this.createEntityQuery([HudElement, ConsoleImage, HudScoreTag]);
    private fpsCounter = new AverageStat(20);

    onUpdate(): void {
        const state = this.world.resources.getOrCreate(GameState)
        this.fpsCounter.add(1000 / this.world.time.deltaTime);
        const fps = this.fpsCounter.getAvg().toFixed(2);
        const prefix = state.gameOver ? Ansi.colors.fg.red + "GAME OVER  " : "";

        this.hudScoreQuery
            .stream({image: ConsoleImage}, {includeEntity: false})
            .forEach(({image}) => {
                image.image = [
                    prefix +
                    Ansi.colors.fg.green + `Score: ${state.score}  Best: ${state.best}  ` +
                    Ansi.colors.fg.yellow + `${fps} FPS`,
                ];
            });
    }
}

class GlobalInputSystem extends System {
    private playerQuery = this.createEntityQuery([PlayerTag, LocalPosition]);
    private starQuery = this.createEntityQuery([StarTag, LocalPosition, Alive, ConsoleImage]);
    private hudQuery = this.createEntityQuery([HudElement]);
    private hudEnabled = true;

    protected onCreate(): void {
        this.requireAnyForUpdate(this.playerQuery);

        keyboardInput.when({name: "space"}, () => {
            const state = this.world.resources.getOrCreate(GameState)
            if (state.gameOver) return;
            this.playerQuery
                .stream({position: LocalPosition}, {includeEntity: false})
                .forEach(({position}) => {
                    const px = position.x ?? 0,
                        py = position.y ?? 0;
                    for (let i = 0; i < 24; i++) {
                        const angle = (i / 24) * Math.PI * 2;
                        const radius = 4 + Math.random() * 6;
                        this.spawnStar(px + Math.cos(angle) * radius, py + Math.sin(angle) * radius);
                    }
                });
        });

        keyboardInput.when({name: "r"}, () => this.resetGame());

        keyboardInput.when({name: "tab"}, () => {
            this.hudEnabled = !this.hudEnabled;
            const cb = this.world.getOrCreateSystem(EntityCommandBufferSystem).createEntityCommandBuffer();
            cb.setEnabledStateForQuery(this.hudQuery, this.hudEnabled);
        });

        keyboardInput.when({name: "return"}, () => {
            const renderer = this.world.tryGetSystem(RenderingSystemGroup);
            if (renderer) renderer.enabled = !renderer.enabled;
        });

        keyboardInput.when({name: "c", ctrl: true}, () => {
            this.world.stop();
            if (typeof process !== "undefined" && (process as any).exit) (process as any).exit(0);
        });
    }

    onUpdate(): void {
    }

    private spawnStar(x: number, y: number) {
        const cb = this.world.getOrCreateSystem(EntityCommandBufferSystem).createEntityCommandBuffer();
        const entity = cb.createEntity("Star");
        const img = new ConsoleImage();
        img.image = [Ansi.colors.fg.yellow + "*"];
        cb.addComponent(entity, img);
        cb.addComponent(entity, new LocalToWorld());
        cb.addComponent(entity, new LocalPosition(x, y));
        cb.addComponent(entity, new StarTag());
        cb.addComponent(entity, new Alive(true));
    }

    private resetGame() {
        const state = this.world.resources.getOrCreate(GameState)
        if (!state.gameOver) return;

        // Reset state
        state.score = 0;
        state.gameOver = false;

        // Reset player/enemy positions
        const setPos = (tag: typeof PlayerTag | typeof EnemyTag, x: number, y: number) => {
            this.createEntityQuery([tag, LocalPosition])
                .stream({position: LocalPosition}, {includeEntity: false})
                .forEach(({position}) => {
                    position.x = x;
                    position.y = y;
                });
        };
        setPos(PlayerTag, 0, 0);
        setPos(EnemyTag, 12, -6);

        // Reset all stars via ECS: mark dead & park off-screen
        this.starQuery
            .stream({position: LocalPosition, alive: Alive, image: ConsoleImage})
            .forEach(({position, alive, image}) => {
                alive.value = false;
                image.image = [""];
                position.x = 9999;
                position.y = 9999;
            });

        // Repopulate
        for (let i = 0; i < 25; i++) this.spawnStar((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 30);
    }
}

// =====================================================================================
// Boot
// =====================================================================================
const game = new Game();
// Ensure systems are present before starting the loop
// (Systems are installed in Game constructor)

game.start();


