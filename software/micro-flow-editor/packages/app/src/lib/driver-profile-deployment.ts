import type { DeviceProfileDraft } from "@spaghettilab/device-profile-authoring-model";
/** Only profiles installed by this editor for this Core are eligible for cleanup.
 * Firmware refuses removal while a live configuration still references a profile. */
export async function installDriverProfiles(
  profiles: readonly DeviceProfileDraft[],
  owned: readonly { profileId: string; version: number }[],
  callbacks: {
    install: (profile: DeviceProfileDraft) => Promise<void>;
    remove: (profileId: string, version: number) => Promise<boolean>;
    remember: (profiles: readonly { profileId: string; version: number }[]) => void;
  },
) {
  let retained = [...owned];
  const cleanup = async () => {
    const next: typeof retained = [];
    for (const entry of retained) {
      if (
        profiles.some(
          (profile) =>
            profile.profileId === entry.profileId && profile.version === entry.version,
        ) ||
        !(await callbacks.remove(entry.profileId, entry.version))
      )
        next.push(entry);
    }
    retained = next;
    callbacks.remember(retained);
  };
  await cleanup();
  for (const profile of profiles) {
    await callbacks.install(profile);
    if (
      !retained.some(
        (entry) =>
          entry.profileId === profile.profileId && entry.version === profile.version,
      )
    )
      retained.push({ profileId: profile.profileId, version: profile.version });
    callbacks.remember(retained);
  }
  return cleanup;
}
