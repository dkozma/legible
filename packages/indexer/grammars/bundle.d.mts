export interface BundleFile {
  fileName: string
  source: string | Uint8Array
}
export function bundleFiles(): BundleFile[]
