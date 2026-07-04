import type { NyxProject } from '@nyx/shared';

export interface NewProjectOptions {
    name: string;
}

export function createNewProject(opts: NewProjectOptions): NyxProject {
    return {
        nyxVersion:    '1.0.0',
        name:           opts.name,
        textures:       [],
        templates:      [],
        rooms:          [],
        sounds:         [],
        fonts:          [],
        styles:         [],
        behaviors:      [],
        scripts:        [],
        enums:          [],
        emitterTandems: [],
        uiLayers:       [],
        assets:         [],
        modules:        {},
        actions:        [],
        globalVars:     [],
        physicsGroups:  [],
        contentTypes:   [],
        settings: {
            authoring: {
                author:         '',
                site:           '',
                title:          opts.name,
                version:        [0, 0, 0],
                versionPostfix: '',
                appId:          '',
            },
            rendering: {
                usePixiLegacy:           true,
                transparent:             false,
                maxFPS:                  60,
                pixelatedrender:         false,
                highDensity:             true,
                desktopMode:             'maximized',
                hideCursor:              false,
                mobileScreenOrientation: 'unspecified',
                viewMode:                'scaleFit',
            },
            export: {
                showErrors:       true,
                errorsLink:       '',
                autocloseDesktop: true,
                windows:          true,
                linux:            true,
                mac:              true,
                codeModifier:     'none',
                bundleAssetTree:  false,
                bundleAssetTypes: {
                    texture: false, template: false, room: false,
                    behavior: false, script: false, font: false,
                    sound: false, style: false, tandem: false,
                },
            },
            branding: {
                accent:                  '#446adb',
                invertPreloaderScheme:   true,
                icon:                    '',
                splashScreen:            '',
                forceSmoothIcons:        false,
                forceSmoothSplashScreen: false,
                hideLoadingLogo:         false,
                alternativeLogo:         false,
                customLoadingText:       '',
            },
        },
    };
}
