# SPDX to Dependency Graph Action

This repository makes it easy to upload an SPDX 2.2 formatted SBOM to GitHub's dependency submission API.
This lets you quickly receive Dependabot alerts for package manifests which GitHub doesn't directly support like pnpm or Paket by using existing off-the-shelf SBOM generators.

### Example workflow

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
    - uses: actions/checkout@v3
    - name: Generate SBOM
      run: | 
        curl -Lo $RUNNER_TEMP/sbom-tool https://github.com/microsoft/sbom-tool/releases/latest/download/sbom-tool-linux-x64
        chmod +x $RUNNER_TEMP/sbom-tool
        $RUNNER_TEMP/sbom-tool generate -b . -bc . -pn ${{ github.repository }} -pv 1.0.0 -ps OwnerName -nsb https://sbom.mycompany.com -V Verbose
    - uses: actions/upload-artifact@v3
      with:
        name: sbom
        path: _manifest/spdx_2.2
    - name: SBOM upload 
      uses: advanced-security/spdx-dependency-submission-action@v0.1.0
      with:
        filePath: "_manifest/spdx_2.2/"
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
