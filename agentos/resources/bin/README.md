Place bundled helper binaries here for packaging.

For iMessage support, AgentOS will prefer these executable names in this directory:

- `agentos-imessage-bridge`

When packaged, Electron Forge copies `resources/bin` into the app's Resources
directory, and AgentOS resolves the bundled executable before falling back to PATH.

Notes:
- The binary must be executable (`chmod +x`).
- On macOS release builds, the binary must be codesigned/notarized with the app.
- The bridge still requires macOS privacy permissions to access Messages data.
