/** Limits of the Backbone builds shipped with this editor. Unknown boards
 * still use the firmware's remote validator. USB payload size is a different limit. */
export function backboneConfigLimit(variant: string | undefined, version: string | undefined): number | undefined {
 if (variant === "backbone-v1-esp32s3") return 512;
 if (variant !== "backbone-v2-esp32s3") return undefined;
 const match=version?.match(/^(\d+)\.(\d+)\.(\d+)/);
 if (!match) return undefined;
 const [major,minor,patch]=match.slice(1).map(Number);
 if (major!>0 || minor!>5 || (minor===5 && patch!>=47)) return 1024;
 return major!>0 || minor!>5 || (minor===5 && patch!>=35) ? 576 : 512;
}
