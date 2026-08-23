# SPDX to Dependency Graph Action

This repository makes it easy to upload an SPDX 2.2 formatted SBOM to GitHub's dependency submission API.
This lets you quickly receive Dependabot alerts for package manifests which GitHub doesn't directly support like pnpm or Paket by using existing off-the-shelf SBOM generators.

## Example workflow

This workflow uses the [Microsoft sbom-tool](https://github.com/microsoft/sbom-tool).

```yaml
name: SBOM upload

on: 
  workflow_dispatch:
  push: 
    branches: ["main"]

jobs:
  SBOM-upload:

    runs-on: ubuntu-latest
    permissions: 
      id-token: write
      contents: write
      
    steps:
    - uses: actions/checkout@v4
    - name: Generate SBOM
      run: | 
        curl -Lo $RUNNER_TEMP/sbom-tool https://github.com/microsoft/sbom-tool/releases/latest/download/sbom-tool-linux-x64
        chmod +x $RUNNER_TEMP/sbom-tool
        $RUNNER_TEMP/sbom-tool generate -b . -bc . -pn ${{ github.repository }} -pv 1.0.0 -ps OwnerName -nsb https://sbom.mycompany.com -V Verbose
    - uses: actions/upload-artifact@v4
      with:
        name: sbom
        path: _manifest/spdx_2.2
    - name: SBOM upload 
      uses: advanced-security/spdx-dependency-submission-action@v0.3.2
      with:
        filePath: "_manifest/spdx_2.2/"
```

## Submit to another repository

Set `repo` to submit the snapshot to a repository other than the one running the workflow. `owner` defaults to the workflow repository owner. When `repoSha` or `repoRef` is omitted, the action detects it from the checked-out repository at `repoPath`. Set `repoPath` when the target repository is checked out somewhere other than the Actions working directory.

Provide `repoRef` explicitly when the target repository is checked out at a detached HEAD.

This example assumes `target_sha` is provided as a workflow input.
For a branch checkout at `repoPath`, `repoSha` and `repoRef` can be omitted and auto-detected.

```yaml
    - uses: actions/checkout@v4
      with:
        repository: my-org/target-repo
        path: target-repo
    - name: SBOM upload
      uses: advanced-security/spdx-dependency-submission-action@v0
      with:
        filePath: target-repo/_manifest/spdx_2.2
        filePattern: target-repo.spdx.json
        token: ${{ secrets.TARGET_REPOSITORY_TOKEN }}
        owner: my-org
        repo: target-repo
        repoPath: target-repo
        repoSha: ${{ inputs.target_sha }}
        repoRef: refs/heads/main
```

The token must have permission to submit dependency snapshots to the target repository.

Add support for running inside a matrix by overriding the default correlator unique identifier to include the job+matrix values.  Consider these sample steps:

```yaml
      # Format correlator as "job(matrixvalue1, matrixvalue2, ... )" or just "job" with a null matrix
      - name: Define correlator
        id: matrix_parser
        run: |
            correlator=$(echo '${{ toJSON(matrix) }}' | jq -r 'if . == null then "${{ github.job }}" else "${{ github.job }}(" + ([.[] | tostring] | join(", ")) + ")" end')
            echo "correlator=$correlator" >> $GITHUB_OUTPUT

      - name: SBOM upload
        uses: advanced-security/spdx-dependency-submission-action@v0.3.2
        with:
          filePath: "${{ matrix.sbom }}"
          correlator: ${{ steps.matrix_parser.outputs.correlator }}
```

## Support

Please create [GitHub Issues][github-issues] if there are bugs or feature requests.

This project uses [Sematic Versioning (v2)](https://semver.org/) and with major releases, breaking changes will occur.

## License

This project is licensed under the terms of the MIT open source license.
Please refer to [MIT][license] for the full terms.

<!-- Resources -->

[license]: ./LICENSE
[github-issues]: https://github.com/advanced-security/spdx-dependency-submission-action/issues
