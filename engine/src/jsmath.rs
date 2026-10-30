// Math that must give the same bits as JavaScript (V8), so a seed plays the same battle in both engines.
// pow and tanh are ports of V8's fdlibm code (src/base/ieee754.cc); exp in the libm crate already matches.
// Only the inputs the simulator uses are handled: pow with x > 0 (or 0) and finite y.

fn hi(x: f64) -> i32 { (x.to_bits() >> 32) as i32 }
fn lo(x: f64) -> u32 { x.to_bits() as u32 }
fn with_hi(x: f64, h: i32) -> f64 { f64::from_bits(((h as u32 as u64) << 32) | (x.to_bits() & 0xffff_ffff)) }
fn with_lo(x: f64, l: u32) -> f64 { f64::from_bits((x.to_bits() & 0xffff_ffff_0000_0000) | l as u64) }

pub fn exp(x: f64) -> f64 { libm::exp(x) }

pub fn pow(x: f64, y: f64) -> f64 {
    const BP: [f64; 2] = [1.0, 1.5];
    const DP_H: [f64; 2] = [0.0, 5.84962487220764160156e-01];
    const DP_L: [f64; 2] = [0.0, 1.35003920212974897128e-08];
    const TWO53: f64 = 9007199254740992.0;
    const HUGE: f64 = 1.0e300;
    const TINY: f64 = 1.0e-300;
    const L1: f64 = 5.99999999999994648725e-01; const L2: f64 = 4.28571428578550184252e-01;
    const L3: f64 = 3.33333329818377432918e-01; const L4: f64 = 2.72728123808534006489e-01;
    const L5: f64 = 2.30660745775561754067e-01; const L6: f64 = 2.06975017800338417784e-01;
    const P1: f64 = 1.66666666666666019037e-01; const P2: f64 = -2.77777777770155933842e-03;
    const P3: f64 = 6.61375632143793436117e-05; const P4: f64 = -1.65339022054652515390e-06;
    const P5: f64 = 4.13813679705723846039e-08;
    const LG2: f64 = 6.93147180559945286227e-01; const LG2_H: f64 = 6.93147182464599609375e-01;
    const LG2_L: f64 = -1.90465429995776804525e-09; const OVT: f64 = 8.0085662595372944372e-0017;
    const CP: f64 = 9.61796693925975554329e-01; const CP_H: f64 = 9.61796700954437255859e-01;
    const CP_L: f64 = -7.02846165095275826516e-09;
    const IVLN2: f64 = 1.44269504088896338700e+00; const IVLN2_H: f64 = 1.44269502162933349609e+00;
    const IVLN2_L: f64 = 1.92596299112661746887e-08;
    assert!(x >= 0.0 && x.is_finite() && y.is_finite(), "jsmath::pow only takes x >= 0 and finite y");
    let (hx, lx, hy, ly) = (hi(x), lo(x), hi(y), lo(y));
    let (mut ix, iy) = (hx & 0x7fffffff, hy & 0x7fffffff);
    if (iy as u32 | ly) == 0 { return 1.0; }
    if ly == 0 {
        if iy == 0x3ff00000 { return if hy < 0 { 1.0 / x } else { x }; }
        if hy == 0x40000000 { return x * x; }
        if hy == 0x3fe00000 { return x.sqrt(); }
    }
    let mut ax = x.abs();
    if lx == 0 && (ix == 0 || ix == 0x3ff00000) { return if hy < 0 { 1.0 / ax } else { ax }; }
    let s = 1.0;
    let (t1, t2);
    if iy > 0x41e00000 {
        if iy > 0x43f00000 {
            if ix <= 0x3fefffff { return if hy < 0 { HUGE * HUGE } else { TINY * TINY }; }
            if ix >= 0x3ff00000 { return if hy > 0 { HUGE * HUGE } else { TINY * TINY }; }
        }
        if ix < 0x3fefffff { return if hy < 0 { s * HUGE * HUGE } else { s * TINY * TINY }; }
        if ix > 0x3ff00000 { return if hy > 0 { s * HUGE * HUGE } else { s * TINY * TINY }; }
        let t = ax - 1.0;
        let w = (t * t) * (0.5 - t * (0.3333333333333333333333 - t * 0.25));
        let u = IVLN2_H * t;
        let v = t * IVLN2_L - w * IVLN2;
        let a = with_lo(u + v, 0);
        t1 = a; t2 = v - (a - u);
    } else {
        let mut n: i32 = 0;
        if ix < 0x00100000 { ax *= TWO53; n -= 53; ix = hi(ax); }
        n += (ix >> 20) - 0x3ff;
        let j = ix & 0x000fffff;
        ix = j | 0x3ff00000;
        let k: usize;
        if j <= 0x3988E { k = 0; } else if j < 0xBB67A { k = 1; } else { k = 0; n += 1; ix -= 0x00100000; }
        ax = with_hi(ax, ix);
        let u = ax - BP[k];
        let v = 1.0 / (ax + BP[k]);
        let ss = u * v;
        let s_h = with_lo(ss, 0);
        let t_h = with_hi(0.0, ((ix >> 1) | 0x20000000) + 0x00080000 + ((k as i32) << 18));
        let t_l = ax - (t_h - BP[k]);
        let s_l = v * ((u - s_h * t_h) - s_h * t_l);
        let mut s2 = ss * ss;
        let mut r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
        r += s_l * (s_h + ss);
        s2 = s_h * s_h;
        let t_h = with_lo(3.0 + s2 + r, 0);
        let t_l = r - ((t_h - 3.0) - s2);
        let u = s_h * t_h;
        let v = s_l * t_h + t_l * ss;
        let p_h = with_lo(u + v, 0);
        let p_l = v - (p_h - u);
        let z_h = CP_H * p_h;
        let z_l = CP_L * p_h + p_l * CP + DP_L[k];
        let t = n as f64;
        let a = with_lo(((z_h + z_l) + DP_H[k]) + t, 0);
        t1 = a; t2 = z_l - (((a - t) - DP_H[k]) - z_h);
    }
    let y1 = with_lo(y, 0);
    let p_l = (y - y1) * t1 + y * t2;
    let mut p_h = y1 * t1;
    let mut z = p_l + p_h;
    let (j, i) = (hi(z), lo(z));
    if j >= 0x40900000 {
        if ((j - 0x40900000) as u32 | i) != 0 { return s * HUGE * HUGE; }
        if p_l + OVT > z - p_h { return s * HUGE * HUGE; }
    } else if (j & 0x7fffffff) >= 0x4090cc00 {
        if ((j as u32).wrapping_sub(0xc090cc00) | i) != 0 { return s * TINY * TINY; }
        if p_l <= z - p_h { return s * TINY * TINY; }
    }
    let i = j & 0x7fffffff;
    let mut k = (i >> 20) - 0x3ff;
    let mut n: i32 = 0;
    if i > 0x3fe00000 {
        n = j + (0x00100000 >> (k + 1));
        k = ((n & 0x7fffffff) >> 20) - 0x3ff;
        let t = with_hi(0.0, n & !(0x000fffff >> k));
        n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
        if j < 0 { n = -n; }
        p_h -= t;
    }
    let t = with_lo(p_l + p_h, 0);
    let u = t * LG2_H;
    let v = (p_l - (t - p_h)) * LG2 + t * LG2_L;
    z = u + v;
    let w = v - (z - u);
    let t = z * z;
    let t1 = z - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
    let r = (z * t1) / ((t1 - 2.0) - (w + z * w));
    z = 1.0 - (r - z);
    let jj = hi(z).wrapping_add(((n as u32) << 20) as i32);
    if (jj >> 20) <= 0 { z = libm::scalbn(z, n); } else { z = with_hi(z, hi(z).wrapping_add(((n as u32) << 20) as i32)); }
    s * z
}

fn expm1(mut x: f64) -> f64 {
    const LN2_HI: f64 = 6.93147180369123816490e-01; const LN2_LO: f64 = 1.90821492927058770002e-10;
    const INVLN2: f64 = 1.44269504088896338700e+00;
    const Q1: f64 = -3.33333333333331316428e-02; const Q2: f64 = 1.58730158725481460165e-03;
    const Q3: f64 = -7.93650757867487942473e-05; const Q4: f64 = 4.00821782732936239552e-06;
    const Q5: f64 = -2.01099218183624371326e-07;
    let mut hx = hi(x) as u32;
    let xsb = hx & 0x80000000;
    hx &= 0x7FFFFFFF;
    if hx >= 0x4043687A {
        if hx >= 0x40862E42 && x > 7.09782712893383973096e+02 { return f64::INFINITY; }
        if xsb != 0 { return -1.0; }
    }
    let (k, c): (i32, f64);
    if hx > 0x3FD62E42 {
        let (hi_, lo_);
        if hx < 0x3FF0A2B2 {
            if xsb == 0 { hi_ = x - LN2_HI; lo_ = LN2_LO; k = 1; } else { hi_ = x + LN2_HI; lo_ = -LN2_LO; k = -1; }
        } else {
            k = (INVLN2 * x + if xsb == 0 { 0.5 } else { -0.5 }) as i32;
            let t = k as f64;
            hi_ = x - t * LN2_HI; lo_ = t * LN2_LO;
        }
        x = hi_ - lo_;
        c = (hi_ - x) - lo_;
    } else if hx < 0x3C900000 {
        return x;
    } else { k = 0; c = 0.0; }
    let hfx = 0.5 * x;
    let hxs = x * hfx;
    let r1 = 1.0 + hxs * (Q1 + hxs * (Q2 + hxs * (Q3 + hxs * (Q4 + hxs * Q5))));
    let t = 3.0 - r1 * hfx;
    let mut e = hxs * ((r1 - t) / (6.0 - x * t));
    if k == 0 { return x - (x * e - hxs); }
    let twopk = f64::from_bits(((0x3FF00000u32.wrapping_add((k as u32) << 20)) as u64) << 32);
    e = x * (e - c) - c;
    e -= hxs;
    if k == -1 { return 0.5 * (x - e) - 0.5; }
    if k == 1 { return if x < -0.25 { -2.0 * (e - (x + 0.5)) } else { 1.0 + 2.0 * (x - e) }; }
    if k <= -2 || k > 56 {
        let y = 1.0 - (e - x);
        let y = if k == 1024 { y * 2.0 * 8.98846567431158e+307 } else { y * twopk };
        return y - 1.0;
    }
    if k < 20 {
        let t = with_hi(1.0, 0x3FF00000 - (0x200000 >> k));
        (t - (e - x)) * twopk
    } else {
        let t = with_hi(1.0, (0x3FF - k) << 20);
        ((x - (e + t)) + 1.0) * twopk
    }
}

pub fn tanh(x: f64) -> f64 {
    let jx = hi(x);
    let ix = jx & 0x7FFFFFFF;
    if ix >= 0x7FF00000 { return if jx >= 0 { 1.0 } else { -1.0 }; }
    let z;
    if ix < 0x40360000 {
        if ix < 0x3E300000 { return x; }
        if ix >= 0x3FF00000 { let t = expm1(2.0 * x.abs()); z = 1.0 - 2.0 / (t + 2.0); }
        else { let t = expm1(-2.0 * x.abs()); z = -t / (t + 2.0); }
    } else { z = 1.0; }
    if jx >= 0 { z } else { -z }
}

// JavaScript's Math.round: halves go up.
pub fn round(x: f64) -> f64 { (x + 0.5).floor() }
