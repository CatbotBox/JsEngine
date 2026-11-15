export const MAT4_FLOATS = 16;
export const MAT4_FLOATS_SHIFT = 4;
export const MAT4_TRANSLATION_X = 12;
export const MAT4_TRANSLATION_Y = 13;
export const MAT4_TRANSLATION_Z = 14;

export const MAT4_ELEMENT = {
    m00: 0, m10: 1, m20: 2, m30: 3,
    m01: 4, m11: 5, m21: 6, m31: 7,
    m02: 8, m12: 9, m22: 10, m32: 11,
    m03: MAT4_TRANSLATION_X, m13: MAT4_TRANSLATION_Y, m23: MAT4_TRANSLATION_Z, m33: 15,
} as const;
