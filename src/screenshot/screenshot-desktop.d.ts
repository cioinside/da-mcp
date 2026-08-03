declare module 'screenshot-desktop' {
  type Options = { screen?: number }
  type ScreenshotFn = (opts?: Options) => Promise<Buffer>
  const fn: ScreenshotFn
  export default fn
}
