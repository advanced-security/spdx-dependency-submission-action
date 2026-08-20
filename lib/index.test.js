import * as lib from './index.js';
import packageurl from 'packageurl-js';

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
        const rootDocument = JSON.parse(JSON.stringify(document));
        rootDocument.packages = rootDocument.packages.slice(0, 1);
        rootDocument.relationships = rootDocument.relationships.slice(0, 1);
        let someCallCount = 0;
        rootDocument.relationships.some = function (predicate) {
            someCallCount++;
            return Array.prototype.some.call(this, predicate);
        };

        const manifest = lib.getManifestFromSpdxFile(rootDocument, "test.spdx.json");

        expect(manifest.directDependencies().map(pkg => pkg.packageID())).toEqual([
            "pkg:npm/direct-dependency@1.0.0"
        ]);
        expect(someCallCount).toBe(1);
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