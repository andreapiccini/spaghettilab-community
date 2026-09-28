# Identity boundary V1

Community owns a complete local identity and authorization system. Hardware device ID,
friendly name, local principals, permissions, audit, credential revocation and
maintenance recovery are not commercial restrictions and remain public.

Production may provide enterprise enrollment through the versioned backend in
`firmware/backbone/include/spaghetti/enrollment.h`. Its absence is a supported state:
initialization succeeds, status is `UNMANAGED`, and enrollment commands return
`-ENOTSUP`. All ordinary Community functions continue to work.

The public layer accepts ephemeral enrollment input but never persists or logs the
activation secret. A private backend owns CA communication, secure certificate/key
storage, renewal, organization membership and fleet revocation. Non-secret status may
be exposed to local clients.

This is a source/build interface compiled with the exact pinned Community commit, not
an ABI guarantee for independently compiled firmware objects.
