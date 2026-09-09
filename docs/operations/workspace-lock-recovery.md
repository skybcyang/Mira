# Workspace Lock Recovery

Mira creates `.mira-workspace.lock` in each Node-backed workspace before it
opens recovery or any writable API. A second Standalone or Desktop host fails
closed with `WORKSPACE_LOCKED`. The lock metadata is diagnostic only; Mira
never decides that a lock is stale from its PID, timestamp, or hostname.

If a host crashed and left the lock behind:

1. Stop every Standalone, Desktop, and other writer that can use this workspace.
2. Make a copy or backup of the workspace before changing the lock state.
3. Confirm that no writer remains, then remove only that workspace's
   `.mira-workspace.lock` file.
4. Start Mira again and verify that the workspace opens and its Board data is
   present.

Do not remove the file while another writer is running. Removing a live lock
can allow two processes to write the same workspace and can cause data loss.
