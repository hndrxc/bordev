import { Effect } from '@babylonjs/core/Materials/effect';

export const ELLIPSE_SHADER_KEY = 'bordevSelectionEllipse';
export const HEALTH_SHADER_KEY = 'bordevHealthBar';
export const MARQUEE_SHADER_KEY = 'bordevMarquee';
export const PLACEMENT_GHOST_SHADER_KEY = 'bordevPlacementGhost';

export function ensureOverlayShaders(): void {
  if (!Effect.ShadersStore[`${ELLIPSE_SHADER_KEY}VertexShader`]) {
    Effect.ShadersStore[`${ELLIPSE_SHADER_KEY}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
attribute vec4 iColor;

uniform mat4 viewProjection;
varying vec2 vLocalUV;
varying vec4 vColor;

void main() {
    mat4 finalWorld = mat4(world0, world1, world2, world3);
    gl_Position = viewProjection * (finalWorld * vec4(position, 1.0));
    vLocalUV = uv * 2.0 - 1.0;
    vColor = iColor;
}
`;
  }

  if (!Effect.ShadersStore[`${ELLIPSE_SHADER_KEY}FragmentShader`]) {
    Effect.ShadersStore[`${ELLIPSE_SHADER_KEY}FragmentShader`] = `
precision highp float;
varying vec2 vLocalUV;
varying vec4 vColor;

void main() {
    float dist = length(vLocalUV);
    if (dist > 1.0) {
        discard;
    }
    float ring = smoothstep(0.78, 0.85, dist) * smoothstep(1.0, 0.93, dist);
    float fill = 0.16 * smoothstep(0.0, 0.85, 1.0 - dist);
    float alpha = clamp(ring + fill, 0.0, 1.0) * vColor.a;
    gl_FragColor = vec4(vColor.rgb, alpha);
}
`;
  }

  // Health-bar shaders: unused iBarColor and vBarColor removed per ReviewRender#4.
  // world0..3 retained so Babylon can bind matrix thin-instance buffer without shader compilation error.
  if (!Effect.ShadersStore[`${HEALTH_SHADER_KEY}VertexShader`]) {
    Effect.ShadersStore[`${HEALTH_SHADER_KEY}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
attribute vec3 iPos;
attribute vec4 iBar;

uniform mat4 viewProjection;
uniform vec3 uRightBasis;
uniform vec3 uUpBasis;

varying vec2 vUV;
varying vec4 vBar;

void main() {
    float dx = (uv.x - 0.5) * iBar.x;
    float dy = (uv.y - 0.5) * iBar.y + iBar.w;
    vec3 worldPos = iPos + dx * uRightBasis + dy * uUpBasis;
    gl_Position = viewProjection * vec4(worldPos, 1.0);
    vUV = uv;
    vBar = iBar;
}
`;
  }

  if (!Effect.ShadersStore[`${HEALTH_SHADER_KEY}FragmentShader`]) {
    Effect.ShadersStore[`${HEALTH_SHADER_KEY}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
varying vec4 vBar;

void main() {
    float borderX = 0.035;
    float borderY = 0.14;
    if (vUV.x < borderX || vUV.x > (1.0 - borderX) || vUV.y < borderY || vUV.y > (1.0 - borderY)) {
        gl_FragColor = vec4(0.06, 0.06, 0.06, 0.95);
        return;
    }

    float innerX = (vUV.x - borderX) / (1.0 - 2.0 * borderX);
    float hpFrac = clamp(vBar.z, 0.0, 1.0);

    if (innerX <= hpFrac) {
        vec3 hpColor;
        if (hpFrac > 0.5) {
            hpColor = vec3(0.2, 0.88, 0.25);
        } else if (hpFrac > 0.25) {
            hpColor = vec3(0.95, 0.82, 0.12);
        } else {
            hpColor = vec3(0.95, 0.2, 0.12);
        }
        gl_FragColor = vec4(hpColor, 0.98);
    } else {
        gl_FragColor = vec4(0.22, 0.06, 0.06, 0.82);
    }
}
`;
  }

  if (!Effect.ShadersStore[`${MARQUEE_SHADER_KEY}VertexShader`]) {
    Effect.ShadersStore[`${MARQUEE_SHADER_KEY}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;

uniform vec2 uScreenSize;
uniform vec4 uBox;

varying vec2 vUV;
varying vec2 vBoxSize;

void main() {
    float minX = min(uBox.x, uBox.z);
    float maxX = max(uBox.x, uBox.z);
    float minY = min(uBox.y, uBox.w);
    float maxY = max(uBox.y, uBox.w);

    float px = mix(minX, maxX, uv.x);
    float py = mix(minY, maxY, uv.y);

    float ndcX = (px / uScreenSize.x) * 2.0 - 1.0;
    float ndcY = 1.0 - (py / uScreenSize.y) * 2.0;

    gl_Position = vec4(ndcX, ndcY, -0.999, 1.0);
    vUV = uv;
    vBoxSize = vec2(max(maxX - minX, 1.0), max(maxY - minY, 1.0));
}
`;
  }

  if (!Effect.ShadersStore[`${MARQUEE_SHADER_KEY}FragmentShader`]) {
    Effect.ShadersStore[`${MARQUEE_SHADER_KEY}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
varying vec2 vBoxSize;

void main() {
    float dx = min(vUV.x, 1.0 - vUV.x) * vBoxSize.x;
    float dy = min(vUV.y, 1.0 - vUV.y) * vBoxSize.y;
    float dist = min(dx, dy);

    if (dist < 1.5) {
        gl_FragColor = vec4(0.2, 0.92, 0.38, 0.92);
    } else {
        gl_FragColor = vec4(0.2, 0.92, 0.38, 0.12);
    }
}
`;
  }
  if (!Effect.ShadersStore[`${PLACEMENT_GHOST_SHADER_KEY}VertexShader`]) {
    Effect.ShadersStore[`${PLACEMENT_GHOST_SHADER_KEY}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
attribute vec4 iColor;
attribute vec4 iParams;

uniform mat4 viewProjection;
varying vec2 vUV;
varying vec4 vColor;
varying vec4 vParams;

void main() {
    mat4 finalWorld = mat4(world0, world1, world2, world3);
    gl_Position = viewProjection * (finalWorld * vec4(position, 1.0));
    vUV = uv;
    vColor = iColor;
    vParams = iParams;
}
`;
  }

  if (!Effect.ShadersStore[`${PLACEMENT_GHOST_SHADER_KEY}FragmentShader`]) {
    Effect.ShadersStore[`${PLACEMENT_GHOST_SHADER_KEY}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
varying vec4 vColor;
varying vec4 vParams;

void main() {
    vec2 size = vParams.xy;
    vec2 tileCoord = vUV * size;

    // 1. Distance to the outer perimeter (in tile units)
    float distToLeft = tileCoord.x;
    float distToRight = size.x - tileCoord.x;
    float distToTop = tileCoord.y;
    float distToBottom = size.y - tileCoord.y;
    float borderDist = min(min(distToLeft, distToRight), min(distToTop, distToBottom));

    // Outer outline: border width is ~0.06 tiles (~3-4 screen pixels at zoom 1)
    // Anti-aliased edge between 0.04 and 0.07
    float borderFactor = 1.0 - smoothstep(0.04, 0.07, borderDist);

    // 2. Internal tile grid lines (for footprints with width > 1 or height > 1)
    // Distance to nearest integer tile border
    float gridDistX = abs(fract(tileCoord.x - 0.5) - 0.5);
    float gridDistY = abs(fract(tileCoord.y - 0.5) - 0.5);
    float gridDist = min(gridDistX, gridDistY);

    // Grid line width ~0.03 tiles (~2 screen pixels)
    // Only apply grid inside the footprint (where borderDist > 0.05)
    float gridFactor = (1.0 - smoothstep(0.015, 0.035, gridDist)) * step(0.05, borderDist);

    // 3. Composite fill and lines
    // Base translucent ground footprint: alpha 0.28
    // Outer outline: alpha 0.90
    // Inner grid lines: alpha 0.60
    float fillAlpha = 0.28;
    float alpha = clamp(fillAlpha + borderFactor * 0.62 + gridFactor * 0.32, 0.0, 1.0) * vColor.a;

    // Slight brightness boost on the border and grid lines to make the outline pop
    vec3 rgb = vColor.rgb * (1.0 + borderFactor * 0.35 + gridFactor * 0.15);

    gl_FragColor = vec4(rgb, alpha);
}
`;
  }
}
