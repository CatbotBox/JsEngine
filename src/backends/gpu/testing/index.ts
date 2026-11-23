export {
    compilationError,
    FakeCanvas,
    FakeCanvasContext,
    FakeCommandBuffer,
    FakeCommandEncoder,
    FakeGpuBuffer,
    FakeGpuDevice,
    FakeGpuError,
    FakeGpuQueue,
    FakeGpuShaderModule,
    FakeGpuTexture,
    FakeGpuTextureView,
    FakeRenderPass,
} from "./fakeGpuDevice";
export type {CompilationMessages, PipelineCreationFailure, RecordedBufferWrite, RecordedCall, RecordedTextureWrite} from "./fakeGpuDevice";
export {ConsoleRecorder} from "./consoleRecorder";
