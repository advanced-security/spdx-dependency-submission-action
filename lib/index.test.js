import * as lib from './index.js';
import packageurl from 'packageurl-js';

function getManifestWithRelationships(relationships) {
    return lib.getManifestFromSpdxFile({
        name: "test manifest",
        packages: [{
            SPDXID: "SPDXRef-Dependency",
            name: "dependency",
            packageVersion: "1.0.0",
            purl: "pkg:npm/dependency@1.0.0"
        }],
        relationships
    }, "test.spdx.json");
}

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

describe("dependency relationships", () => {
    test("classifies a root-only dependency as direct", () => {
        const manifest = getManifestWithRelationships([{
            spdxElementId: "SPDXRef-RootPackage",
            relationshipType: "DEPENDS_ON",
            relatedSpdxElement: "SPDXRef-Dependency"
        }]);

        expect(manifest.directDependencies()).toHaveLength(1);
        expect(manifest.indirectDependencies()).toHaveLength(0);
    });

    test("classifies a non-root-only dependency as indirect", () => {
        const manifest = getManifestWithRelationships([{
            spdxElementId: "SPDXRef-Parent",
            relationshipType: "DEPENDS_ON",
            relatedSpdxElement: "SPDXRef-Dependency"
        }]);

        expect(manifest.directDependencies()).toHaveLength(0);
        expect(manifest.indirectDependencies()).toHaveLength(1);
    });

    test("classifies a dependency with root and non-root parents as direct", () => {
        const manifest = getManifestWithRelationships([
            {
                spdxElementId: "SPDXRef-RootPackage",
                relationshipType: "DEPENDS_ON",
                relatedSpdxElement: "SPDXRef-Dependency"
            },
            {
                spdxElementId: "SPDXRef-Parent",
                relationshipType: "DEPENDS_ON",
                relatedSpdxElement: "SPDXRef-Dependency"
            }
        ]);

        expect(manifest.directDependencies()).toHaveLength(1);
        expect(manifest.indirectDependencies()).toHaveLength(0);
    });
});