export interface SampleProject {
    readonly label: string;
    readonly path: string;
}

export const SAMPLE_PROJECTS: readonly SampleProject[] = [
    {label: "2D", path: "demo/2d"},
    {label: "3D", path: "demo/3d"},
    {label: "Swarm", path: "demo/swarm"},
];
