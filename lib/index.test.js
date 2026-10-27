import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Snapshot } from '@github/dependency-submission-toolkit';
import * as lib from './index.js';
import packageurl from 'packageurl-js';

const targetInputs = ['INPUT_REPO', 'INPUT_OWNER', 'INPUT_REPOSHA', 'INPUT_REPOREF', 'INPUT_REPOPATH'];

afterEach(() => {
    targetInputs.forEach(input => delete process.env[input]);
});

describe("submission context", () => {
    const workflowContext = {
        eventName: "pull_request",
        payload: {
            pull_request: {
                head: {
                    sha: "workflow-pull-request-sha"
                }
            }
        },
        ref: "refs/pull/1/merge",
        repo: {
            owner: "workflow-owner",
            repo: "workflow-repo"
        },
        runId: 123,
        sha: "workflow-sha"
    };

    test("uses the workflow context when no target repository is provided", () => {
        expect(lib.getSubmissionContext(workflowContext)).toBe(workflowContext);
    });

    test("uses explicit target repository values", () => {
        process.env.INPUT_REPO = "target-repo";
        process.env.INPUT_OWNER = "target-owner";
        process.env.INPUT_REPOSHA = "target-sha";
        process.env.INPUT_REPOREF = "refs/heads/target";

        const targetContext = lib.getSubmissionContext(workflowContext);
        const snapshot = new Snapshot(
            { name: "test", version: "1.0.0", url: "https://example.com" },
            targetContext,
            { correlator: "test", id: "123" }
        );

        expect(targetContext.repo).toEqual({
            owner: "target-owner",
            repo: "target-repo"
        });
        expect(snapshot.sha).toBe("target-sha");
        expect(snapshot.ref).toBe("refs/heads/target");
        expect(workflowContext.eventName).toBe("pull_request");
    });

    test("defaults the target owner to the workflow repository owner", () => {
        process.env.INPUT_REPO = "target-repo";
        process.env.INPUT_REPOSHA = "target-sha";
        process.env.INPUT_REPOREF = "refs/heads/target";

        expect(lib.getSubmissionContext(workflowContext).repo.owner).toBe("workflow-owner");
    });

    test("auto-detects the target SHA and ref from the checked-out repository", () => {
        const repository = fs.mkdtempSync(path.join(os.tmpdir(), "spdx-submission-"));
        try {
            execFileSync('git', ['init', '--quiet', '--initial-branch=target'], { cwd: repository });
            fs.writeFileSync(path.join(repository, 'fixture.txt'), 'fixture');
            execFileSync('git', ['add', 'fixture.txt'], { cwd: repository });
            execFileSync('git', [
                'remote', 'add', 'origin', 'https://github.com/workflow-owner/target-repo.git'
            ], { cwd: repository });
            execFileSync('git', [
                '-c', 'user.name=Test',
                '-c', 'user.email=test@example.com',
                'commit', '--quiet', '-m', 'Initial commit'
            ], { cwd: repository });
            const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
                cwd: repository,
                encoding: 'utf8'
            }).trim();
            process.env.INPUT_REPO = "target-repo";

            const targetContext = lib.getSubmissionContext(workflowContext, repository);

            expect(targetContext.sha).toBe(sha);
            expect(targetContext.ref).toBe("refs/heads/target");
        } finally {
            fs.rmSync(repository, { recursive: true, force: true });
        }
    });

    test("requires explicit target metadata when the working directory is not the target checkout", () => {
        const repository = fs.mkdtempSync(path.join(os.tmpdir(), "spdx-submission-"));
        try {
            execFileSync('git', ['init', '--quiet', '--initial-branch=target'], { cwd: repository });
            execFileSync('git', [
                'remote', 'add', 'origin', 'https://github.com/workflow-owner/other-repo.git'
            ], { cwd: repository });
            process.env.INPUT_REPO = "target-repo";

            expect(() => lib.getSubmissionContext(workflowContext, repository)).toThrow(
                "The repoPath directory is not a checkout of 'workflow-owner/target-repo'. Provide 'repoSha' and 'repoRef' explicitly or set 'repoPath' to a checkout of 'workflow-owner/target-repo'."
            );
        } finally {
            fs.rmSync(repository, { recursive: true, force: true });
        }
    });

    test("requires an explicit target ref for a detached checkout", () => {
        const repository = fs.mkdtempSync(path.join(os.tmpdir(), "spdx-submission-"));
        try {
            execFileSync('git', ['init', '--quiet', '--initial-branch=target'], { cwd: repository });
            fs.writeFileSync(path.join(repository, 'fixture.txt'), 'fixture');
            execFileSync('git', ['add', 'fixture.txt'], { cwd: repository });
            execFileSync('git', [
                'remote', 'add', 'origin', 'https://github.com/workflow-owner/target-repo.git'
            ], { cwd: repository });
            execFileSync('git', [
                '-c', 'user.name=Test',
                '-c', 'user.email=test@example.com',
                'commit', '--quiet', '-m', 'Initial commit'
            ], { cwd: repository });
            execFileSync('git', ['checkout', '--quiet', '--detach', 'HEAD'], { cwd: repository });
            process.env.INPUT_REPO = "target-repo";

            expect(() => lib.getSubmissionContext(workflowContext, repository))
                .toThrow("Unable to auto-detect 'repoRef' from a detached HEAD. Provide the 'repoRef' input.");
        } finally {
            fs.rmSync(repository, { recursive: true, force: true });
        }
    });
});

describe("dependency classification", () => {
    const document = {
        name: "test manifest",
        packages: [
            {
                SPDXID: "SPDXRef-DirectDependency",
                name: "direct-dependency",
                packageVersion: "1.0.0",
                purl: "pkg:npm/direct-dependency@1.0.0"
            },
            {
                SPDXID: "SPDXRef-IndirectDependency",
                name: "indirect-dependency",
                packageVersion: "2.0.0",
                purl: "pkg:npm/indirect-dependency@2.0.0"
            }
        ],
        relationships: [
            {
                spdxElementId: "SPDXRef-RootPackage",
                relationshipType: "DEPENDS_ON",
                relatedSpdxElement: "SPDXRef-DirectDependency"
            },
            {
                spdxElementId: "SPDXRef-DirectDependency",
                relationshipType: "DEPENDS_ON",
                relatedSpdxElement: "SPDXRef-IndirectDependency"
            }
        ]
    };

    test("classifies a root dependency as direct", () => {
        const manifest = lib.getManifestFromSpdxFile(document, "test.spdx.json");

        expect(manifest.directDependencies().map(pkg => pkg.packageID())).toEqual([
            "pkg:npm/direct-dependency@1.0.0"
        ]);
    });

    test("classifies a dependency with a non-root parent as indirect", () => {
        const manifest = lib.getManifestFromSpdxFile(document, "test.spdx.json");

        expect(manifest.indirectDependencies().map(pkg => pkg.packageID())).toEqual([
            "pkg:npm/indirect-dependency@2.0.0"
        ]);
    });

    test("preserves the relationship between direct and indirect dependencies", () => {
        const manifest = lib.getManifestFromSpdxFile(document, "test.spdx.json");
        const [directDependency] = manifest.directDependencies();

        expect(directDependency.packageDependencyIDs).toEqual([
            "pkg:npm/indirect-dependency@2.0.0"
        ]);
        expect(JSON.parse(JSON.stringify(manifest)).resolved[
            "pkg:npm/direct-dependency@1.0.0"
        ].dependencies).toEqual([
            "pkg:npm/indirect-dependency@2.0.0"
        ]);
    });

    test("classifies a shared dependency as direct", () => {
        const sharedDoc = JSON.parse(JSON.stringify(document));
        sharedDoc.packages.push({
            SPDXID: "SPDXRef-SharedDependency",
            name: "shared-dependency",
            packageVersion: "3.0.0",
            purl: "pkg:npm/shared-dependency@3.0.0"
        });
        sharedDoc.relationships.push(
            {
                spdxElementId: "SPDXRef-RootPackage",
                relationshipType: "DEPENDS_ON",
                relatedSpdxElement: "SPDXRef-SharedDependency"
            },
            {
                spdxElementId: "SPDXRef-DirectDependency",
                relationshipType: "DEPENDS_ON",
                relatedSpdxElement: "SPDXRef-SharedDependency"
            }
        );

        const manifest = lib.getManifestFromSpdxFile(sharedDoc, "test.spdx.json");
        const directIds = manifest.directDependencies().map(pkg => pkg.packageID());
        const indirectIds = manifest.indirectDependencies().map(pkg => pkg.packageID());

        expect(directIds).toContain("pkg:npm/shared-dependency@3.0.0");
        expect(indirectIds).not.toContain("pkg:npm/shared-dependency@3.0.0");
        expect(
            manifest.lookupDependency(
                manifest.directDependencies().find(pkg =>
                    pkg.packageID() === "pkg:npm/direct-dependency@1.0.0"
                )
            ).depPackage.packageDependencyIDs
        ).toContain("pkg:npm/shared-dependency@3.0.0");
    });

    test("classifies a dependency without a relationship as direct", () => {
        const unrelatedDoc = {
            name: "test manifest",
            packages: [
                {
                    SPDXID: "SPDXRef-UnrelatedDependency",
                    name: "unrelated-dependency",
                    packageVersion: "4.0.0",
                    purl: "pkg:npm/unrelated-dependency@4.0.0"
                }
            ],
            relationships: []
        };

        const manifest = lib.getManifestFromSpdxFile(unrelatedDoc, "test.spdx.json");

        expect(manifest.directDependencies().map(pkg => pkg.packageID())).toEqual([
            "pkg:npm/unrelated-dependency@4.0.0"
        ]);
        expect(manifest.indirectDependencies()).toEqual([]);
    });
});

describe("manifest path", () => {
    const document = {
        name: "test manifest",
        packages: []
    };
    let directory;
    let spdxFile;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "spdx-submission-"));
        spdxFile = path.join(directory, "test.spdx.json");
        fs.writeFileSync(spdxFile, JSON.stringify(document));
    });

    afterEach(() => {
        fs.rmSync(directory, { recursive: true, force: true });
    });

    test("uses the SPDX file path by default", () => {
        const [manifest] = lib.getManifestsFromSpdxFiles([spdxFile]);

        expect(manifest.file.source_location).toBe(spdxFile);
    });

    test("uses the configured manifest path", () => {
        const [manifest] = lib.getManifestsFromSpdxFiles([spdxFile], "requirements.txt");

        expect(manifest.file.source_location).toBe("requirements.txt");
    });

    test("rejects a custom manifest path for multiple SPDX files", () => {
        expect(() => lib.getManifestsFromSpdxFiles(
            [spdxFile, spdxFile],
            "requirements.txt"
        )).toThrow(
            "The 'manifestPath' input can only be used when one SPDX file is uploaded."
        );
    });
});

test("the SPDX fixture submits the patched launch-editor version", () => {
    const document = JSON.parse(fs.readFileSync(
        new URL('../test/manifest.spdx.json', import.meta.url)
    ));
    const packages = document.packages.filter(pkg => pkg.name === "launch-editor");

    expect(packages).toHaveLength(1);
    expect(packages[0].versionInfo).toBe("2.14.2");

    const manifest = lib.getManifestFromSpdxFile({
        name: document.name,
        packages
    }, "manifest.spdx.json");

    expect(manifest.directDependencies().map(pkg => pkg.packageID())).toEqual([
        "pkg:npm/launch-editor@2.14.2"
    ]);
});

describe("generic purl fallback (no purl field, no PACKAGE-MANAGER externalRef)", () => {
    // Mirrors real-world SBOMs like Yocto's create-spdx-2.2.bbclass output: packages have
    // neither a `purl` field nor a PACKAGE-MANAGER externalRef (only SECURITY/cpe23Type refs
    // for CVE lookups), so the generic purl fallback is exercised - see
    // https://github.com/advanced-security/spdx-dependency-submission-action/issues/26
    test("uses versionInfo (the spec-defined field) to build the generic purl", () => {
        const document = {
            name: "test manifest",
            packages: [
                {
                    SPDXID: "SPDXRef-Package-zlib",
                    name: "zlib",
                    versionInfo: "1.3.1"
                }
            ],
            relationships: []
        };

        const manifest = lib.getManifestFromSpdxFile(document, "test.spdx.json");

        expect(manifest.directDependencies().map(pkg => pkg.packageID())).toEqual([
            "pkg:generic/zlib@1.3.1"
        ]);
    });

    test("falls back to the non-standard packageVersion field if versionInfo is absent", () => {
        const document = {
            name: "test manifest",
            packages: [
                {
                    SPDXID: "SPDXRef-Package-legacy",
                    name: "legacy-package",
                    packageVersion: "2.5.0"
                }
            ],
            relationships: []
        };

        const manifest = lib.getManifestFromSpdxFile(document, "test.spdx.json");

        expect(manifest.directDependencies().map(pkg => pkg.packageID())).toEqual([
            "pkg:generic/legacy-package@2.5.0"
        ]);
    });

    test("prefers versionInfo over packageVersion when both are present", () => {
        const document = {
            name: "test manifest",
            packages: [
                {
                    SPDXID: "SPDXRef-Package-both",
                    name: "both-fields",
                    versionInfo: "3.0.0",
                    packageVersion: "stale-value"
                }
            ],
            relationships: []
        };

        const manifest = lib.getManifestFromSpdxFile(document, "test.spdx.json");

        expect(manifest.directDependencies().map(pkg => pkg.packageID())).toEqual([
            "pkg:generic/both-fields@3.0.0"
        ]);
    });
});

describe("replace version escape", () => {
    test("replace @ in namespace", () => {
        // https://www.npmjs.com/package/@angular/cli
        const purl = "pkg:NPM/@angular/cli@4.17.21";

        var new_purl = lib.replaceVersionEscape(purl);
        expect(new_purl).toBe("pkg:NPM/%40angular/cli@4.17.21");
        packageurl.PackageURL.fromString(new_purl);
    });
    test("if encoding has already happened", () => {
        const purl = "pkg:npm/es-abstract%401.16.0";

        var new_purl = lib.replaceVersionEscape(purl);
        expect(new_purl).toBe("pkg:npm/es-abstract@1.16.0");
        packageurl.PackageURL.fromString(new_purl);

        const purl2 = "pkg:npm/%40vue/cli-shared-utils%404.0.4";
        var new_purl2 = lib.replaceVersionEscape(purl2);
        expect(new_purl2).toBe("pkg:npm/%40vue/cli-shared-utils@4.0.4");
        packageurl.PackageURL.fromString(new_purl2);

    })
    test("replace ^ in version", () => {
        const purl = "pkg:NPM/@angular/cli@^4.17.21";

        var new_purl = lib.replaceVersionEscape(purl);
        expect(new_purl).toBe("pkg:NPM/%40angular/cli@%5E4.17.21");
        packageurl.PackageURL.fromString(new_purl);
    })
    test("replace encoded colon in version", () => {
        const purl = "pkg:deb/ubuntu/bsdutils@1%3A2.39.3-9ubuntu6.5?arch=amd64&distro=ubuntu-24.04&upstream=util-linux%402.39.3-9ubuntu6.5";

        var new_purl = lib.replaceVersionEscape(purl);
        expect(new_purl).toBe("pkg:deb/ubuntu/bsdutils@1:2.39.3-9ubuntu6.5?arch=amd64&distro=ubuntu-24.04&upstream=util-linux%402.39.3-9ubuntu6.5");
        packageurl.PackageURL.fromString(new_purl);
    })
    test("replace encoded colon in scoped package version", () => {
        const purl = "pkg:npm/%40angular/cli@1%3A2?qualifier=colon%3Avalue";

        var new_purl = lib.replaceVersionEscape(purl);
        expect(new_purl).toBe("pkg:npm/%40angular/cli@1:2?qualifier=colon%3Avalue");
        packageurl.PackageURL.fromString(new_purl);
    })
    test("does not rewrite encoded @ in qualifier without version", () => {
        const purl = "pkg:deb/ubuntu/bsdutils?arch=amd64&upstream=util-linux%402.39.3";

        var new_purl = lib.replaceVersionEscape(purl);
        expect(new_purl).toBe("pkg:deb/ubuntu/bsdutils?arch=amd64&upstream=util-linux%402.39.3");
        packageurl.PackageURL.fromString(new_purl);
    })
})