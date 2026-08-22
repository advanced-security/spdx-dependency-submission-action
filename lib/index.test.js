import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Snapshot } from '@github/dependency-submission-toolkit';
import * as lib from './index.js';
import packageurl from 'packageurl-js';

const targetInputs = ['INPUT_REPO', 'INPUT_OWNER', 'INPUT_REPOSHA', 'INPUT_REPOREF'];

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

    test("auto-detects target metadata and explains detached refs", () => {
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

            execFileSync('git', [
                'remote', 'set-url', 'origin', 'https://github.com/workflow-owner/other-repo.git'
            ], { cwd: repository });
            expect(() => lib.getSubmissionContext(workflowContext, repository)).toThrow(
                "the working directory is not a checkout of 'workflow-owner/target-repo'"
            );

            execFileSync('git', [
                'remote', 'set-url', 'origin', 'https://github.com/workflow-owner/target-repo.git'
            ], { cwd: repository });
            execFileSync('git', ['checkout', '--quiet', '--detach', sha], { cwd: repository });
            expect(() => lib.getSubmissionContext(workflowContext, repository)).toThrow(
                "The repository may have a detached HEAD. Provide the 'repoRef' input."
            );
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
})