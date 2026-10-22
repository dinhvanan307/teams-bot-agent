# Provenance and third party components

This repository contains the Fiin Team Bot prototype and the package 1 engineering baseline. It uses Microsoft Teams SDK packages under their respective licenses; the dependency lockfile identifies exact package versions.

The parent workspace was originally associated with `OfficeDev/microsoft-365-agents-toolkit`. This standalone repository does not import that repository's Git history or its deleted template tree. Microsoft names and the local Teams manifest schema identify third party technologies, not endorsement.

No open source license is granted for the project code by this baseline. The owner must decide licensing before public distribution. Preserve third party license notices when distributing dependencies. `npm ci --omit=dev` installs dependency packages with their license files on the target host.

Integration with Microsoft Teams and a real AI provider, and operation on a production host, are not certified by a successful local build or package creation. See the integration plan and current evidence.
