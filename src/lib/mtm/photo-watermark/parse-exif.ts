import exifr from "exifr"

/**
 * Read EXIF metadata from a JPEG buffer. Returns the parsed tag map or
 * null if the buffer has no EXIF / parsing failed. We never throw —
 * the route handles null/empty maps via validateExif's
 * `missing_required_tag` path so callers don't need try/catch.
 *
 * Tags pulled: all of IFD0 (Make/Model/Software/DateTime/ImageDescription),
 * ExifIFD (DateTimeOriginal), and GPS (lat/lng with mergeOutput so they
 * land as numeric `GPSLatitude`/`GPSLongitude` on the result).
 */
export async function parseExifFromBuffer(
  buffer: Buffer,
): Promise<Record<string, unknown> | null> {
  try {
    const result = await exifr.parse(buffer, {
      tiff: true,
      exif: true,
      gps: true,
      mergeOutput: true,
    })
    return (result as Record<string, unknown> | undefined) ?? null
  } catch {
    return null
  }
}
