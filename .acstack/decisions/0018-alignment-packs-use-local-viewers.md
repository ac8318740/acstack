# Alignment packs use local viewers

Alignment packs must not depend on a remote viewer or remote script. ACStack can open a generated pack in a local browser, including through a localhost server.

## Considered options

A pinned remote viewer keeps generated files smaller. It also makes review depend on network access and trust in a hosted script.

## Consequences

ACStack must inline or vendor the viewer code it needs. A Herdr-style terminal view can follow later if a clean graph viewer exists.
