/* The wordmark's versions. A page load shows one of them; each is a small fragment shader drawn over the letters in one
   canvas. This file holds the shared GLSL, the versions, and the code that lays the letters out, measures them and runs the
   chosen version. app.js mounts it; nothing else here touches the page.

   A version is given: the letters as a coverage mask; when it asks, a distance field of the letters (how far a point is
   from the nearest edge) with a height map of the letters blown up like a balloon, and a strip of glyphs; the pointer; the
   page's two colours; and time. The canvas reaches a little past the letters on every side, so a version may draw there.
   Lengths inside a version are in ems of the wordmark, measured from where the first letter meets the baseline, so one
   version looks the same on a phone and on a wide screen. */
window.Wordmark = (() => {
'use strict';

const LIB = `precision highp float;
uniform vec2 u_res, u_org, u_ptr, u_sres, u_cell;
uniform float u_time, u_seed, u_dark, u_em, u_dpr, u_ptr_on, u_width;
uniform float u_lx[13];
uniform vec3 u_fg, u_bg;
uniform sampler2D u_mask, u_sdf, u_glyph;
const float TAU = 6.28318530718, PI = 3.14159265359;
#define OUTSIDE if (a < .003) { gl_FragColor = vec4(0.); return; }
float sat(float x){ return clamp(x, 0., 1.); }
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash2(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*f*(f*(f*6.-15.)+10.);
  return mix(mix(hash(i), hash(i+vec2(1.,0.)), u.x), mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.,1.)), u.x), u.y); }
float fbm(vec2 p){ float v = 0., a = .5; for(int i=0;i<5;i++){ v += a*noise(p); p = p*2.03 + vec2(11.7, 5.3); a *= .5; } return v; }
float fbm3(vec2 p){ float v = 0., a = .5; for(int i=0;i<3;i++){ v += a*noise(p); p = p*2.03 + vec2(11.7, 5.3); a *= .5; } return v; }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d){ return a + b*cos(TAU*(c*t + d)); }
vec3 pick5(float i, vec3 a, vec3 b, vec3 c, vec3 d, vec3 f){ i = mod(i, 5.); return i < .5 ? a : (i < 1.5 ? b : (i < 2.5 ? c : (i < 3.5 ? d : f))); }
float cov(vec2 px){ return texture2D(u_mask, vec2(px.x/u_res.x, 1. - px.y/u_res.y)).a; }
vec2 em(vec2 px){ return (px - u_org)/u_em; }
vec2 unem(vec2 e){ return u_org + e*u_em; }
float letter(float x){ float n = -1.; for (int i = 0; i < 13; i++) n += step(u_lx[i], x); return n; }       /* which character a column belongs to, 0 to 11; the space is 5 */
void put(vec3 c, float a){ a = sat(a); gl_FragColor = vec4(clamp(c, 0., 1.)*a, a); }
/* the measured letters: x is the distance to the nearest edge in em (negative inside), y the height of the letters blown up, in em */
vec2 sdtap(vec2 ij){ ij = clamp(ij, vec2(0.), u_sres - 1.); vec4 t = texture2D(u_sdf, vec2((ij.x + .5)/u_sres.x, 1. - (ij.y + .5)/u_sres.y)); return vec2(t.r*65280. + t.g*255., t.b*65280. + t.a*255.)/65535.; }
vec2 sdh(vec2 px){ vec2 s = px/u_res*u_sres - .5; vec2 i = floor(s), f = s - i;
  vec2 v = mix(mix(sdtap(i), sdtap(i + vec2(1., 0.)), f.x), mix(sdtap(i + vec2(0., 1.)), sdtap(i + vec2(1., 1.)), f.x), f.y);
  return vec2((v.x - .5)*.6, v.y*.25); }
vec3 bulge(vec2 px, float k){ float ex = u_res.x/u_sres.x;       /* the normal of the blown-up letters */
  vec2 g = vec2(sdh(px + vec2(ex, 0.)).y - sdh(px - vec2(ex, 0.)).y, sdh(px + vec2(0., ex)).y - sdh(px - vec2(0., ex)).y)*u_em/(2.*ex);
  return normalize(vec3(-g*k, 1.)); }
/* cells with a seed point each: x is how far this point is from the nearest wall between two cells, yz names the cell */
vec3 plates(vec2 p){ vec2 i = floor(p), f = fract(p); float d1 = 8., d2 = 8.; vec2 id = vec2(0.);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){ vec2 g = vec2(float(x), float(y)); vec2 r = g + hash2(i + g) - f; float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = i + g; } else if (d < d2) { d2 = d; } }
  return vec3(sqrt(d2) - sqrt(d1), id); }
/* the first wordmark's liquid metal: dark on a light page, bright on a dark one */
vec3 metal(vec2 p, float t){
  vec3 A = mix(vec3(.25, .26, .29), vec3(.77, .78, .81), u_dark), B = mix(vec3(.26, .26, .27), vec3(.21, .21, .19), u_dark), D = vec3(0., .02, .05);
  vec2 q = vec2(fbm(p + vec2(0., t*.6)), fbm(p + vec2(5.2, 1.3 + t*.45)));
  vec2 r = vec2(fbm(p + 3.2*q + vec2(1.7, 9.2 + t*.3)), fbm(p + 3.2*q + vec2(8.3, 2.8 + t*.25)));
  float f = fbm(p + 2.6*r + vec2(0., t*.2)), v = f*2. + .45*length(q) + .25*r.x;
  vec3 col = A + B*cos(TAU*(v + D));
#ifdef DERIV
  float hgt = fbm3(p*.55 + 1.1*r + vec2(0., t*.2));
  vec2 g = vec2(dFdx(hgt), dFdy(hgt))*(.98*u_em)*1.5;
  vec3 n = normalize(vec3(-g, 1.)), L = normalize(vec3(-.42, .62, .66));
  float diff = clamp(dot(n, L), 0., 1.), spec = pow(clamp(dot(n, normalize(L + vec3(0., 0., 1.))), 0., 1.), 64.), slope = clamp(length(g)*.35, 0., 1.);
  col = col*(.74 + .36*diff);
  col += mix(.16, .14, u_dark)*.16*slope*cos(TAU*(slope*1.7 + v*.5 + vec3(0., .33, .67)));
  col += spec*mix(.9, .6, u_dark)*.5;
#endif
  return col; }
vec2 metalAt(vec2 e){ return vec2(e.x - u_width*.5, (e.y - .28)*.55)/.98*.95 + vec2(u_seed*1.37, u_seed*-.91); }
`;

/* name: one short word, shown beside the number when the wordmark changes.  note: what it is, for the list of versions.
   needs: 'sdf' (the measured letters) and/or 'glyph' (the strip of characters).  still: the moment drawn for a reader who
   has asked for no motion. */
const LOGOS = [
{ name: 'mercury', note: 'liquid metal sliding down. the first one.', still: 12.5, frag: `
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px);
  vec3 col = metal(metalAt(em(px)), u_time/5.2);
  col += (hash(px + u_seed) - .5)*.018;
  put(col, a);
}` },

{ name: 'drip', note: 'the same metal, running off the bottom of the letters in drips.', needs: 'sdf', still: 9., frag: `
float drip(vec2 e, float t){                       /* how far this point is from the nearest drip under the baseline, in em */
  float d = 1.;
  for (int k = -1; k <= 1; k++){
    float i = floor(e.x/.17) + float(k);
    float h1 = hash(vec2(i, 3.1 + u_seed)), h2 = hash(vec2(i, 7.7 + u_seed)), h3 = hash(vec2(i, 13.3));
    float xd = (i + .5 + (h1 - .5)*.55)*.17;
    float here = step(.5, cov(unem(vec2(xd, .045))))*step(.3, h2);                 /* only where a letter stands on the line */
    float u = fract(t/(5. + 6.*h3) + h1*7.);
    float grow = smoothstep(0., .62, u), let = smoothstep(.62, .7, u), fall = max(0., (u - .62)/.38);
    float L = (.05 + .13*h2)*grow*(1. - .65*let), rb = (.016 + .011*grow)*(1. - .55*let);
    float y = clamp(e.y, -L, .03), w = mix(.011, .019, sat((e.y + L)/max(L, .001)));
    float ds = length(vec2(e.x - xd, e.y - y)) - w, dt = length(e - vec2(xd, -L)) - rb;
    float dd = length((e - vec2(xd, -L - .02 - 1.9*fall*fall))*vec2(1., .8)) - .018;
    float dk = min(min(ds, dt), mix(1., dd, step(.001, fall)));
    d = min(d, mix(1., dk, here));
  }
  return d;
}
void main(){
  vec2 px = gl_FragCoord.xy; vec2 e = em(px); float a = cov(px), t = u_time;
  float dl = sdh(px).x, dd = drip(e, t), k = .03, h = sat(.5 + .5*(dd - dl)/k);
  float d = mix(dd, dl, h) - k*h*(1. - h), aa = .8/u_em;                         /* letter and drip run together where they meet */
  a = max(a, smoothstep(aa, -aa, d)*step(e.y, .06)*smoothstep(-.33, -.27, e.y));
  vec3 col = metal(metalAt(e), t/5.2);
  col += (hash(px + u_seed) - .5)*.018;
  put(col, a);
}` },

{ name: 'tide', note: 'the letters fill with ink like glasses, slosh, and drain.', still: 7.5, frag: `
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); OUTSIDE
  vec2 e = em(px); float t = u_time, u = fract(t/18.);
  float full = smoothstep(0., .36, u) - smoothstep(.6, .94, u), lvl = mix(-.06, .57, full), sl = .012 + .03*sin(PI*sat(u/.94));
  float y1 = lvl + sl*sin(e.x*2.3 - t*1.7) + .5*sl*sin(e.x*5.9 + t*2.6), y2 = lvl + .016 + sl*sin(e.x*1.9 + t*1.4 + 1.) + .5*sl*sin(e.x*4.7 - t*2.1);
  float aa = 1.2/u_em, front = smoothstep(aa, -aa, e.y - y1), back = smoothstep(aa, -aa, e.y - y2);
  vec3 deep = mix(vec3(.02, .07, .62), vec3(.2, .3, 1.), u_dark), top = mix(vec3(.1, .32, 1.), vec3(.62, .74, 1.), u_dark);
  vec3 col = mix(u_bg, u_fg, .12 + .1*u_dark);                                    /* the empty glass */
  col = mix(col, mix(top, u_bg, .35), back);
  vec3 liq = mix(deep, top, smoothstep(-.1, .62, e.y)*(.55 + .45*sat(1. - (y1 - e.y)*3.)));
  float cw = .075, ci = floor(e.x/cw), bh = hash(vec2(ci, 4.4));                 /* bubbles on their way up */
  vec2 bc = vec2((ci + .5 + .3*sin(t*2. + bh*40.))*cw, mix(-.08, lvl, fract(bh*7. + t*(.05 + .07*bh))));
  float br = .006 + .01*hash(vec2(ci, 9.));
  liq = mix(liq, vec3(1.), .5*smoothstep(br + aa, br - aa, length(e - bc))*step(.45, bh));
  col = mix(col, liq, front);
  col += vec3(.35)*front*smoothstep(.014, 0., y1 - e.y);                        /* light caught along the surface */
  put(col, a);
}` },

{ name: 'lavalamp', note: 'wax rising and sinking in a warm lamp.', still: 7., frag: `
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); OUTSIDE
  vec2 e = em(px); float t = u_time, f = 0.;
  for (int i = 0; i < 16; i++){
    float fi = float(i), h1 = hash(vec2(fi, 1.7 + u_seed)), h2 = hash(vec2(fi, 9.2 + u_seed)), ph = t*(.15 + .18*h1) + h2*TAU;
    vec2 c = vec2((fi + .5)/16.*u_width + .3*sin(t*.07*(1. + h1) + fi*2.4), .27 + .36*sin(ph));
    float r = .085 + .075*h2; vec2 d = e - c; d.y *= 1. + .22*cos(ph);
    f += r*r/(dot(d, d) + 1e-4);
  }
  float blob = smoothstep(.94, 1.06, f);
  vec3 medium = mix(vec3(1., .36, .12), vec3(.5, .08, .46), smoothstep(-.12, .5, e.y)); medium = mix(medium, vec3(.17, .07, .42), smoothstep(.36, .8, e.y));
  medium += vec3(.5, .2, .05)*sat(f*.35)*.5;
  vec3 wax = mix(vec3(1., .62, .1), vec3(1., .93, .58), smoothstep(1., 2.4, f));
  vec3 col = mix(medium, wax, blob);
  col += (hash(px + u_seed) - .5)*.03;
  put(col, a);
}` },

{ name: 'pool', note: 'light on the floor of a swimming pool.', still: 5., frag: `
float cell(vec2 p, float t){ vec2 i = floor(p), f = fract(p); float d = 8.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){ vec2 g = vec2(float(x), float(y)); vec2 r = g + .5 + .5*sin(t + TAU*hash2(i + g)) - f; d = min(d, dot(r, r)); }
  return sqrt(d); }
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); OUTSIDE
  vec2 p = em(px)*3.1 + u_seed; float t = u_time*.8;
  vec2 w = .22*vec2(sin(p.y*1.3 + t*.7), cos(p.x*1.1 - t*.6));
  float c1 = cell(p + w, t), c2 = cell(p*1.43 - w + 4.7, t*1.27 + 2.), c = min(c1, c2*1.1);
  vec3 col = mix(vec3(0., .36, .62), vec3(.05, .7, .8), sat(c*1.2)) + vec3(.85, 1., .95)*pow(sat(c*1.32), 3.6)*1.2 + vec3(.1, .3, .25)*pow(sat(c1*1.3), 8.);
  put(col, a);
}` },

{ name: 'marble', note: 'marbled paper, combed, drifting sideways.', still: 30., frag: `
vec3 ink(float i){ float h = hash(vec2(i, 2.2 + floor(u_seed))); vec3 c = vec3(.12, .18, .36);
  c = mix(c, vec3(.48, .12, .17), step(.24, h)); c = mix(c, vec3(.85, .64, .25), step(.44, h)); c = mix(c, vec3(.18, .43, .45), step(.62, h));
  c = mix(c, vec3(.88, .8, .62), step(.8, h)); c = mix(c, vec3(.1, .1, .11), step(.93, h)); return c; }
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); OUTSIDE
  vec2 p = em(px); float t = u_time*.03; p.x += t*1.2;
  float s3 = .09, d3 = abs(fract(p.x/s3 + .5) - .5)*s3; p.y -= (.11 + .03*sin(t*4.))*exp(-d3/(s3*.24));                 /* the fine comb, drawn up the sheet */
  float s2 = .21, k2 = floor(p.y/s2 + .5), d2 = abs(p.y - k2*s2); p.x -= (mod(k2, 2.)*2. - 1.)*(.3 + .05*cos(t*3.))*exp(-d2/(s2*.3));       /* the rake, back and forth */
  float v = p.x*5. + 1.1*fbm3(p*vec2(1.4, 2.6) + u_seed), id = floor(v), fr = fract(v);
  vec3 col = ink(id)*(.55 + .45*smoothstep(0., .07, fr)*smoothstep(1., .93, fr));
  col = mix(col, vec3(.95, .92, .84), .5*step(.985, hash(floor(px/(u_dpr*1.3)))));
  col += (hash(px) - .5)*.035;
  put(col, a);
}` },

{ name: 'agate', note: 'a slice of banded stone, the bands creeping outward.', still: 15., frag: `
vec3 band(float i){ float h = hash(vec2(i, 5.5 + floor(u_seed))); vec3 c = vec3(.6, .72, .9); c = mix(c, vec3(.4, .58, .84), step(.2, h)); c = mix(c, vec3(.2, .38, .66), step(.42, h));
  c = mix(c, vec3(.08, .16, .38), step(.62, h)); c = mix(c, vec3(.86, .75, .6), step(.8, h)); c = mix(c, vec3(.7, .36, .2), step(.93, h)); return c; }
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); OUTSIDE
  vec2 e = em(px), p = e*1.1 + u_seed; float d = 9.;
  for (int i = 0; i < 5; i++){ float fi = float(i); d = min(d, length((e - vec2((fi + .5)*u_width/5. + .35*sin(fi*3.1 + u_seed), .27 + .22*cos(fi*2.3 + u_seed*2.)))*vec2(1., 1.3))); }
  float v = d*8. + 2.4*fbm(p*1.5 + .9*vec2(fbm3(p*1.2), fbm3(p*1.2 + 5.))) - u_time*.15, id = floor(v), fr = fract(v);
  vec3 col = mix(band(id), band(id + 1.), smoothstep(.72, 1., fr))*(.9 + .1*smoothstep(0., .1, fr));
  col = mix(col, vec3(.86, .92, 1.), .45*smoothstep(.16, 0., d)*(.6 + .4*hash(floor(px/(u_dpr*2.)))));     /* the crystal in the middle of each */
  col += (hash(px) - .5)*.02;
  put(col, a);
}` },

{ name: 'magma', note: 'a cooling crust with the glow moving under it.', still: 11., frag: `
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); OUTSIDE
  vec2 e = em(px); float t = u_time;
  vec2 p = e*2.7 + vec2(-t*.06, 0.) + .4*vec2(fbm3(e*1.2 + u_seed), fbm3(e*1.2 + 7. + u_seed)) + u_seed;
  vec3 pl = plates(p); float heat = smoothstep(.25, .75, fbm3(p*.55 + vec2(t*.12, t*.05)));
  float crack = smoothstep(.05 + .2*heat, 0., pl.x);
  vec3 crust = mix(vec3(.085, .07, .07), vec3(.27, .17, .15), u_dark)*(.8 + .5*hash(pl.yz)) + .05*fbm3(p*7.);
  vec3 glow = mix(vec3(.85, .1, 0.), vec3(1., .8, .25), sat(crack*heat*1.5));
  put(mix(crust, glow, crack*(.35 + .65*heat)) + vec3(1., .3, .05)*.35*heat*exp(-pl.x*7.), a);
}` },

{ name: 'silk', note: 'red satin, the folds travelling through it.', still: 9., frag: `
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); OUTSIDE
  vec2 e = em(px); float t = u_time*.3;
  vec2 p = e + .14*vec2(fbm3(e*.8 + t*.2 + u_seed), fbm3(e*.8 - t*.2 + 4. + u_seed));
  vec2 k1 = vec2(2.4, 3.6), k2 = vec2(-1.6, 5.2), k3 = vec2(4.6, 1.1);
  vec2 g = .5*cos(dot(p, k1) - t*1.2)*k1 + .33*cos(dot(p, k2) + t*.9 + 1.)*k2 + .22*cos(dot(p, k3) - t*.6)*k3;
  vec3 n = normalize(vec3(-g*.2, 1.)), L = normalize(vec3(-.35, .55, .76)), Hh = normalize(L + vec3(0., 0., 1.));
  vec3 T = normalize(vec3(1., .2, 0.)); T = normalize(T - n*dot(T, n));          /* the way the threads run */
  float th = dot(T, Hh), sheen = pow(sqrt(max(0., 1. - th*th)), 70.);
  vec3 col = vec3(.6, .02, .12)*(.32 + .8*sat(dot(n, L))) + vec3(1., .56, .6)*sheen*.55;
  col += (hash(px) - .5)*.02;
  put(col, a);
}` },

{ name: 'aurora', note: 'northern lights, curtains swaying sideways.', still: 14., frag: `
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); OUTSIDE
  vec2 e = em(px); float t = u_time;
  vec3 col = mix(vec3(.03, .07, .17), vec3(.07, .04, .2), sat(e.y*1.4 + .2));
  vec2 sc = floor(px/(u_dpr*1.4)); col += step(.9972, hash(sc))*(.45 + .4*sin(t*2.5 + hash(sc + 3.)*TAU));
  for (int i = 0; i < 3; i++){
    float fi = float(i);
    float x = e.x*(.85 + .22*fi) + fi*3.7 + u_seed + .3*sin(e.y*2.2 + t*.25 + fi)*(e.y + .2);
    float xx = x + 1.2*fbm3(vec2(x*1.1 + t*(.05 + .03*fi), fi*7. + t*.02));
    float ray = pow(noise(vec2(xx*8., t*.1 + fi*3.)), 1.5)*(.55 + .45*noise(vec2(xx*42., fi)));
    float y0 = -.06 + .15*fi + .13*noise(vec2(xx*1.6, t*.08 + fi));               /* the curtain's hem */
    float body = smoothstep(y0 - .02, y0 + .04, e.y)*exp(-max(e.y - y0, 0.)*(2.4 - .5*fi));
    vec3 c = mix(vec3(.2, 1., .55), vec3(.5, .3, 1.), sat((e.y - y0)*1.8));
    c = mix(c, mix(vec3(1., .3, .65), vec3(.45, .35, 1.), sat((e.y - y0)*2.)), step(1.5, fi));
    col += c*ray*body*(1.5 - .25*fi);
  }
  put(col, a);
}` },

{ name: 'sky', note: 'a window onto evening clouds going by. at night, the moonlit ones.', still: 40., frag: `
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); OUTSIDE
  vec2 e = em(px); float t = u_time;
  vec3 col = mix(mix(vec3(1., .5, .28), vec3(.2, .24, .5), u_dark), mix(vec3(.1, .28, .7), vec3(.03, .05, .2), u_dark), smoothstep(-.08, .72, e.y));
  col += u_dark*step(.997, hash(floor(px/(u_dpr*1.4))))*.7;
  for (int i = 0; i < 2; i++){
    float fi = float(i); vec2 p = vec2(e.x*.85 + t*(.03 + .028*fi) + fi*9. + u_seed, e.y*2.4 + fi*3.)*(1.35 + .8*fi);
    float d = fbm(p), cl = smoothstep(.5, .7, d + .08*fi), sh = fbm(p + vec2(-.1, .14)) - d;
    vec3 cc = mix(mix(vec3(.46, .25, .5), vec3(.13, .16, .36), u_dark), mix(vec3(1., .74, .58), vec3(.78, .83, .97), u_dark), sat(.5 - sh*7.));
    col = mix(col, cc, cl*(.94 - .22*fi));
  }
  col += (hash(px + u_seed) - .5)*.025;
  put(col, a);
}` },

{ name: 'papercut', note: 'layers of cut paper, breathing.', still: 35., frag: `
vec3 lay(float i){ vec3 c = vec3(.106, .122, .369); c = mix(c, vec3(.357, .227, .549), step(.5, i)); c = mix(c, vec3(.78, .255, .482), step(1.5, i)); c = mix(c, vec3(.949, .42, .357), step(2.5, i));
  c = mix(c, vec3(.976, .627, .247), step(3.5, i)); c = mix(c, vec3(.984, .839, .478), step(4.5, i)); return c; }
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); OUTSIDE
  vec2 p = em(px)*vec2(1.25, 1.7) + u_seed; float t = u_time*.05; p += vec2(t, t*.3);
  float h = fbm(p), hs = fbm(p + vec2(-.045, .06));                             /* the light is up and to the left */
  vec3 col = lay(0.);
  for (int i = 1; i < 6; i++){ float L = .3 + float(i)*.075, m = smoothstep(L - .006, L + .006, h), s = smoothstep(L - .035, L + .02, hs)*(1. - m); col *= 1. - .36*s; col = mix(col, lay(float(i)), m); }
  col *= .97 + .06*hash(px);
  put(col, a);
}` },

{ name: 'topo', note: 'a contour map of slow hills.', still: 50., frag: `
float H(vec2 p){ return fbm(p*1.1 + .5*vec2(fbm3(p*.7 + 3.), fbm3(p*.7 + 11.))); }
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); OUTSIDE
  vec2 p = em(px) + u_seed*3.; float t = u_time*.02; p += vec2(t, t*.6);
  float eps = 1.5/u_em, h = H(p); vec2 g = vec2(H(p + vec2(eps, 0.)) - h, H(p + vec2(0., eps)) - h)/eps;
  float N = 17., v = h*N, fr = fract(v), d = min(fr, 1. - fr)/(length(g)*N + 1e-4)*u_em;      /* how many pixels to the nearest contour */
  float major = 1. - step(.5, mod(floor(v + .5), 5.)), w = mix(.5, 1.15, major)*u_dpr, ln = smoothstep(w + .8, w - .2, d);
  float hh = smoothstep(.25, .75, h);
  vec3 tl = mix(vec3(.6, .76, .65), vec3(.78, .83, .58), smoothstep(0., .3, hh)); tl = mix(tl, vec3(.9, .78, .5), smoothstep(.3, .55, hh)); tl = mix(tl, vec3(.86, .63, .4), smoothstep(.55, .8, hh)); tl = mix(tl, vec3(.76, .46, .3), smoothstep(.8, 1., hh));
  vec3 td = mix(vec3(.06, .16, .23), vec3(.07, .25, .29), smoothstep(0., .3, hh)); td = mix(td, vec3(.11, .35, .33), smoothstep(.3, .55, hh)); td = mix(td, vec3(.23, .48, .35), smoothstep(.55, .8, hh)); td = mix(td, vec3(.49, .63, .36), smoothstep(.8, 1., hh));
  put(mix(mix(tl, td, u_dark), mix(vec3(.3, .19, .1), vec3(.86, .95, .8), u_dark), ln*.85), a);
}` },

{ name: 'riso', note: 'three inks off a duplicator, never quite in register.', still: 4., frag: `
void main(){
  vec2 px = gl_FragCoord.xy; vec2 e = em(px); float t = u_time;
  vec2 o1 = .014*vec2(sin(t*.5), cos(t*.37))*u_em, o2 = .014*vec2(cos(t*.43 + 1.), sin(t*.61 + 2.))*u_em, o3 = .011*vec2(sin(t*.29 + 4.), cos(t*.53))*u_em;
  float m1 = cov(px + o1), m2 = cov(px + o2), m3 = cov(px + o3), a = max(m1, max(m2, m3)); OUTSIDE
  vec2 gc = floor(px/(u_dpr*1.25)); float n1 = hash(gc + 11.), n2 = hash(gc + 31.), n3 = hash(gc + 77.);
  float g1 = .86 + .14*sin(e.x*1.3 + e.y*2.2 - t*.35);                                           /* a flood of pink */
  float g2 = step(n2, smoothstep(.2, .8, .5 + .5*sin(e.x*1.7 - e.y*1.1 + t*.3 + 2.*fbm3(e*.8 + u_seed)))*.95);       /* a blue that comes and goes in grain, as a duplicator lays a tint */
  float g3 = smoothstep(.5, .56, fbm3(e*1.7 + vec2(t*.06, u_seed)));                              /* yellow in shapes */
  float i1 = m1*g1*(.82 + .18*step(.2, n1)), i2 = m2*g2, i3 = m3*g3*(.85 + .15*step(.2, n3));
  vec3 paper = mix(u_bg, vec3(.95, .93, .87), u_dark);
  put(paper*mix(vec3(1.), vec3(1., .28, .66), i1)*mix(vec3(1.), vec3(0., .45, .74), i2)*mix(vec3(1.), vec3(1., .9, 0.), i3), a);
}` },

{ name: 'halftone', note: 'printed in three inks of dots. on a dark page, lit in three colours of dots.', still: 8., frag: `
vec3 picture(vec2 e, float t){ float v = .5*fbm3(e*.9 + vec2(-t*.1, t*.06) + u_seed) + .28*sin(e.x*.9 + e.y*1.7 - t*.5) + .3;
  return pal(v, vec3(.7, .66, .68), vec3(.3, .32, .3), vec3(1., .9, .8), vec3(.02, .28, .58)); }
float plate(vec2 px, float ang, float cs, int ch, float t){
  vec2 g = rot(ang)*px/cs, c = floor(g) + .5, f = g - c;
  vec3 img = picture(em(rot(-ang)*(c*cs)), t);
  float v = ch == 0 ? img.r : (ch == 1 ? img.g : img.b);
  v = mix(1. - v, v, u_dark);                                    /* ink is what the picture lacks; a lit dot is what it has */
  float r = sqrt(sat(v))*.74, aa = .9/cs;
  return smoothstep(r + aa, r - aa, length(f)); }
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); OUTSIDE
  float cs = max(.04*u_em, 4.5*u_dpr), t = u_time;
  float dc = plate(px, .262, cs, 0, t), dm = plate(px, 1.309, cs, 1, t), dy = plate(px, 0., cs, 2, t);
  vec3 lt = u_bg*mix(vec3(1.), vec3(0., .62, .9), dc)*mix(vec3(1.), vec3(.92, 0., .5), dm)*mix(vec3(1.), vec3(1., .9, 0.), dy);
  vec3 dk = u_bg + vec3(1., .16, .12)*dc + vec3(.1, 1., .3)*dm + vec3(.15, .3, 1.)*dy;
  put(mix(lt, dk, u_dark), a);
}` },

{ name: 'dither', note: 'one bit deep, like an old screen. the liquid drifts to the right.', still: 6., frag: `
float bayer2(vec2 a){ a = floor(a); return fract(a.x/2. + a.y*a.y*.75); }
float bayer4(vec2 a){ return bayer2(.5*a)*.25 + bayer2(a); }
float bayer8(vec2 a){ return bayer4(.5*a)*.25 + bayer2(a); }
void main(){
  vec2 px = gl_FragCoord.xy; float s = floor(floor(max(2., u_em/u_dpr/58.))*u_dpr + .5); vec2 c = floor(px/s), cc = (c + .5)*s;
  float m = step(.5, cov(cc));
  float n4 = min(min(step(.5, cov(cc + vec2(s, 0.))), step(.5, cov(cc - vec2(s, 0.)))), min(step(.5, cov(cc + vec2(0., s))), step(.5, cov(cc - vec2(0., s)))));
  vec2 p = em(cc)*1.25 + u_seed; float t = u_time;
  float v = fbm(p + vec2(-t*.1, 0.) + 2.*vec2(fbm3(p + vec2(-t*.16, 3.)), fbm3(p + vec2(9., t*.05))));
  v = sat((v - .25)*2.1)*.82 + .12;
  put(u_fg, m*max(step(bayer8(c), v), 1. - n4));               /* the outline is always inked, so the word keeps its shape */
}` },

{ name: 'truchet', note: 'tiles of two arcs, each turning a quarter when the wave reaches it.', still: 2.2, frag: `
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); OUTSIDE
  vec2 e = em(px); float sz = max(.105, 9.*u_dpr/u_em); vec2 g = e/sz, id = floor(g), f = fract(g) - .5;
  float wv = u_time*.45 - (id.x*.13 + id.y*.31) + hash(id)*.9, turn = floor(wv) + smoothstep(0., .35, fract(wv));
  f = rot((turn + floor(hash(id + 5. + floor(u_seed))*4.))*PI*.5)*f;
  float d = min(abs(length(f + .5) - .5), abs(length(f - .5) - .5)), aa = 1./(sz*u_em);
  put(mix(vec3(1., .35, .1), u_fg, smoothstep(.17 + aa, .17 - aa, d)), a);
}` },

{ name: 'flipdot', note: 'a board of discs flipping over, as on an old departures display.', still: 4., frag: `
float lit(vec2 id, float k){ return step(.5, fract((id.x + id.y*1.7)*.045 - k*.11 + .35*noise(id*.13 + k*.21))); }
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); OUTSIDE
  vec2 e = em(px); float sz = max(.056, 5.*u_dpr/u_em); vec2 g = e/sz, id = floor(g), f = fract(g) - .5;
  float tq = u_time*1.5 + hash(id)*.7, k = floor(tq), s0 = lit(id, k), s1 = lit(id, k + 1.), turn = smoothstep(0., .4, fract(tq));
  float s = mix(s0, s1, step(.5, turn)), sq = mix(1., abs(cos(turn*PI)), abs(s1 - s0)), aa = 1./(sz*u_em);
  float disc = smoothstep(.43 + aa, .43 - aa, length(vec2(f.x, f.y/max(sq, .1))));
  vec3 panel = mix(vec3(.05, .05, .06), vec3(.12, .12, .13), u_dark), off = mix(vec3(.15, .15, .16), vec3(.21, .21, .23), u_dark);
  put(mix(panel, mix(off, vec3(.87, .94, .15), s)*(.86 + .28*smoothstep(.3, -.3, f.x + f.y)), disc), a);
}` },

{ name: 'ascii', note: 'the liquid again, typed out in characters.', needs: 'glyph', still: 6., frag: `
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); OUTSIDE
  vec2 c = floor(px/u_cell), f = fract(px/u_cell), p = em((c + .5)*u_cell)*1.2 + u_seed; float t = u_time;
  float v = fbm(p + vec2(t*.06, -t*.09) + 1.6*vec2(fbm3(p + vec2(0., -t*.1)), fbm3(p + 5.)));
  float n = 5. + floor(sat((v - .2)*1.9)*6.99);                                 /* only the dense half of the strip, so a letter stays a dark mass */
  put(u_fg, a*max(texture2D(u_glyph, vec2((n + f.x)/12., 1. - f.y)).a, .16));
}` },

{ name: 'tokens', note: 'written out token by token, in reading order, then cleared.', still: 6.2, frag: `
vec3 tok(float h){ float s = floor(h*5.)/4.; return mix(mix(vec3(.6, .68, 1.), vec3(.07, .15, .84), s), mix(vec3(.17, .23, .64), vec3(.78, .84, 1.), s), u_dark); }
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); OUTSIDE
  vec2 e = em(px); float cyc = u_time/11., u = fract(cyc), k = floor(cyc);
  float rh = max(.118, 8.*u_dpr/u_em), uw = rh*.52, top = .73, nrow = floor((top + .02)/rh) + 1., ncol = floor(u_width/(uw*4.)) + 1.;
  float yy = (top - e.y)/rh, row = floor(yy), fy = fract(yy), xu = e.x/uw, blk = floor(xu/4.), fu = xu - blk*4.;
  float hs = hash(vec2(blk, row*7.3 + k*13.1 + u_seed)), b1 = 4., b2 = 4.;        /* each run of four units is cut into one, two or three tokens */
  if (hs > .16) { b1 = 1.; } if (hs > .34) { b1 = 3.; } if (hs > .52) { b1 = 2.; } if (hs > .72) { b1 = 1.; b2 = 3.; } if (hs > .88) { b1 = 2.; b2 = 3.; }
  float sub = step(b1, fu) + step(b2, fu);
  float x0 = mix(0., mix(b1, b2, step(1.5, sub)), step(.5, sub)), x1 = mix(b1, mix(b2, 4., step(1.5, sub)), step(.5, sub));
  vec2 q = vec2((fu - (x0 + x1)*.5)*uw, (fy - .5)*rh), hb = vec2((x1 - x0)*.5*uw, rh*.5) - max(.006, .6*u_dpr/u_em);
  float rr = min(hb.x, hb.y)*.5, aa = .8/u_em, box = smoothstep(aa, -aa, length(max(abs(q) - hb + rr, 0.)) - rr);
  float order = (row*ncol + blk + sub*.3)/(nrow*ncol), wr = u/.6;
  float there = step(order, wr)*(1. - step(order, (u - .86)/.1));
  float cursor = step(order, wr)*step(wr - 1.2/(nrow*ncol), order)*step(u, .6);
  vec3 col = mix(u_bg, u_fg, .1);                                                 /* how sure the model was of each token is its shade */
  put(mix(col, mix(tok(hash(vec2(blk*3. + sub, row + k*7.))), u_fg, cursor), box*max(there, cursor)), a);
}` },

{ name: 'denoise', note: 'starts as static and resolves into a picture, a different one each time.', still: 7., frag: `
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); OUTSIDE
  vec2 e = em(px); float cyc = u_time/10. + floor(u_seed), u = fract(cyc), k = floor(cyc);
  float st = floor(sat(u/.5)*16.), s = 1. - st/16.; s = s*s;                    /* the noise comes off in steps */
  float undo = smoothstep(.9, 1., u); s = max(s, undo*undo);
  vec2 p = e*vec2(.8, 1.3) + k*17.3, w = vec2(fbm3(p*1.1 + 3.), fbm3(p*1.1 + 8.));
  float f = noise(p*.9 + w) + (1. - s)*.5*fbm(p*2.2 + 2.*w);                    /* the broad shapes first, the fine ones last */
  vec3 img = pal(f*.85 + k*.31, vec3(.56, .5, .56), vec3(.42, .4, .38), vec3(1., 1., 1.), vec3(0., .3, .62));
  vec2 nc = floor(px/(u_dpr*1.5)) + (st + floor(undo*8.)*37.)*vec2(17., 31.);
  put(mix(img, vec3(.5), s*.85) + (vec3(hash(nc), hash(nc + 71.3), hash(nc + 143.7)) - .5)*s*1.15, a);
}` },

{ name: 'glitch', note: 'holds still, then tears sideways for a moment.', still: 1., frag: `
void main(){
  vec2 px = gl_FragCoord.xy; vec2 e = em(px); float cyc = u_time/4.6 + floor(u_seed), k = floor(cyc), u = fract(cyc);
  float on = step(.86, u), tick = floor(u*64.);
  float sl = floor(e.y*(5. + 9.*hash(vec2(k, 2.))) + hash(vec2(tick, k))*3.), r = hash(vec2(sl, tick + k*13.));
  vec2 o = vec2(on*step(.5, r)*(hash(vec2(sl, k + tick)) - .5)*.34, 0.)*u_em, s = vec2(.0035 + on*.03*hash(vec2(tick, k + 5.)), 0.)*u_em;
  vec3 m = vec3(cov(px + o + s), cov(px + o), cov(px + o - s));                  /* the three colours of the screen, pulled apart */
  float ln = on*step(.985, hash(vec2(floor(px.y/(u_dpr*2.)), tick + k)))*.5*step(-.1, e.x)*step(e.x, u_width + .1);
  put(mix(u_bg, u_fg, max(m, vec3(ln))), max(max(m.r, m.g), max(m.b, ln)));
}` },

{ name: 'prisma', note: "lines following the letters' own outlines, flowing inward.", needs: 'sdf', still: 1., frag: `
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); OUTSIDE
  float d = -sdh(px).x, per = max(.032, 4.2*u_dpr/u_em), aa = 1./(per*u_em);
  float ring = smoothstep(.25 - aa, .25 + aa, abs(fract(d/per - u_time*.3) - .5));
  float rim = smoothstep(per*.55 + 1./u_em, per*.55 - 1./u_em, d);              /* the outermost line always stands */
  put(u_fg, a*max(ring, rim));
}` },

{ name: 'neon', note: 'tube lettering in two gases. one letter does not always stay lit.', needs: 'sdf', still: 3., frag: `
void main(){
  vec2 px = gl_FragCoord.xy; float d = sdh(px).x, t = u_time, tube = abs(d + .04), aa = .8/u_em;
  float core = smoothstep(.012 + aa, .012 - aa, tube), glow = (exp(-tube*30.)*.8 + exp(-tube*9.)*.3)*smoothstep(.115, .04, d);
  float li = letter(px.x); vec3 gas = mix(vec3(1., .13, .45), vec3(.05, .8, 1.), step(5.5, li));
  float fl = 1. - step(abs(li - 3.), .5)*.8*step(.62, noise(vec2(t*7., 1.)))*step(.4, noise(vec2(t*.6, 9.)));
  float hum = .93 + .07*sin(t*50. + li);
  vec4 dk = vec4(clamp((gas*glow + core)*fl*hum, 0., 1.), sat(max(core, glow*.7))*max(fl, core*.3));     /* on a dark page the light adds to it */
  float al = max(core, glow*.3*fl);
  vec4 lt = vec4(mix(gas, mix(vec3(.74, .72, .75), mix(gas, vec3(1.), .25), fl), core)*al, al);             /* in daylight: a coloured tube, a faint halo, grey glass where it is out */
  gl_FragColor = mix(lt, dk, u_dark);
}` },

{ name: 'echo', note: 'the word trails outlines of itself, swinging.', needs: 'sdf', still: 2., frag: `
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px), t = u_time, al = 0., aa = .8/u_em;
  vec2 dir = rot(.85*sin(t*.4))*vec2(0., -1.); float amp = (.019 + .006*sin(t*.9))*u_em;
  for (int i = 1; i <= 5; i++){ float fi = float(i); al = max(al, smoothstep(.006 + aa, .006 - aa, abs(sdh(px - dir*fi*amp).x + .008))*(1. - fi/6.)); }
  put(u_fg, max(a, al));
}` },

{ name: 'sundial', note: 'a block shade that swings away from a lamp. the pointer is the lamp.', still: 2., frag: `
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px), t = u_time;
  vec2 lamp = mix(unem(vec2(u_width*.5 + u_width*.55*sin(t*.3), 1.1 + .5*cos(t*.3))), u_ptr, u_ptr_on);
  vec2 dir = normalize(px - lamp + 1e-3); float L = .1*u_em, sh = 0.;
  for (int i = 1; i <= 16; i++) sh = max(sh, cov(px - dir*L*float(i)/16.));
  put(mix(mix(vec3(1., .3, 0.), vec3(1., .66, .1), u_dark), u_fg, a), max(a, sh));
}` },

{ name: 'emboss', note: 'pressed into the page, no ink at all. the pointer is the lamp.', needs: 'sdf', still: 2., frag: `
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); OUTSIDE
  float ex = u_res.x/u_sres.x*1.5, d = sdh(px).x, ang = 2.2 + .7*sin(u_time*.3);
  vec2 g = normalize(vec2(sdh(px + vec2(ex, 0.)).x - sdh(px - vec2(ex, 0.)).x, sdh(px + vec2(0., ex)).x - sdh(px - vec2(0., ex)).x) + 1e-6);
  vec2 L = normalize(mix(vec2(cos(ang), sin(ang)), normalize(u_ptr - px + 1e-3), u_ptr_on));
  float wall = smoothstep(.06, 0., -d), lit = dot(g, L);                          /* the wall nearest the lamp is in its own shadow */
  vec3 col = mix(u_bg, u_fg, .11 + .07*u_dark)*(1. - .62*wall*sat(lit)*(1. - .35*u_dark)) + (.1 + .2*u_dark)*wall*sat(-lit);
  col += (hash(px) - .5)*.012;
  put(col, a);
}` },

{ name: 'balloon', note: 'blown up in foil. the room it reflects turns, or follows the pointer.', needs: 'sdf', still: 4., frag: `
vec3 room(vec3 r, float turn){               /* a pale ceiling, a dark horizon, strip lights, and two coloured lamps low down */
  float az = atan(r.x, r.z + 1e-5) + turn, el = r.y;
  vec3 c = mix(vec3(.2, .21, .25), vec3(.93, .95, 1.), smoothstep(-.1, .8, el));
  c = mix(c, vec3(.07, .07, .09), smoothstep(.14, 0., abs(el + .12)));
  c = mix(c, vec3(.5, .46, .44), smoothstep(-.2, -.9, el));
  c += smoothstep(.88, .96, cos(az*2.))*smoothstep(.15, .3, el)*smoothstep(.95, .7, el)*.9;
  c += vec3(1., .35, .6)*smoothstep(.7, 1., cos(az - 1.9))*smoothstep(.5, -.1, el)*.35 + vec3(.3, .6, 1.)*smoothstep(.7, 1., cos(az + 1.4))*smoothstep(.5, -.1, el)*.3;
  return c; }
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); vec2 e = em(px);
  vec3 n = bulge(px, 1.3);
  n = normalize(n + vec3(.07*(vec2(noise(e*vec2(26., 9.) + u_seed), noise(e*vec2(9., 26.) + 4. + u_seed)) - .5), 0.));      /* the creases of the foil */
  vec3 r = reflect(vec3(0., 0., -1.), n);
  vec2 turn = mix(vec2(.5*sin(u_time*.33), .18*sin(u_time*.21)), (u_ptr - u_org)/u_em/vec2(u_width, .7) - .5, u_ptr_on);
  r.yz = rot(turn.y*.9)*r.yz;
  vec3 col = room(r, u_time*.12 + turn.x*2.4) + pow(1. - n.z, 3.)*.25;
  float sh = smoothstep(.05, -.03, sdh(px + vec2(-.018, .04)*u_em).x)*.2*(1. - u_dark);            /* its shadow on the page */
  gl_FragColor = vec4(clamp(col, 0., 1.)*a, a) + vec4(0., 0., 0., sh*(1. - a));
}` },

{ name: 'glass', note: 'clear glass over ruled lines; the lines bend in it.', needs: 'sdf', still: 5., frag: `
float ruled(vec2 q, float t){ return smoothstep(.2, .3, abs(fract((q.x*.8 + q.y)*11. - t*.9) - .5)); }
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); OUTSIDE
  vec3 n = bulge(px, 1.2); vec2 e = em(px); float t = u_time;
  vec3 s = vec3(ruled(e - n.xy*.17, t), ruled(e - n.xy*.182, t), ruled(e - n.xy*.194, t));        /* each colour of light bends a little differently */
  vec3 col = mix(mix(u_fg, u_bg, s), vec3(.5, .8, .78), .13)*(.66 + .34*n.z);
  col += pow(sat(dot(n, normalize(normalize(vec3(-.5, .6, .62)) + vec3(0., 0., 1.)))), 60.)*.8 + pow(sat(dot(n.xy, vec2(.6, -.6))), 2.)*.14;
  put(col, a);
}` },

{ name: 'gummy', note: 'twelve sweets. now and then a wobble goes down the row.', needs: 'sdf', still: 2.5, frag: `
vec3 sweet(float i){ i = mod(i, 6.); return i < .5 ? vec3(.88, .1, .22) : (i < 1.5 ? vec3(1., .48, .08) : (i < 2.5 ? vec3(.98, .8, .1) : (i < 3.5 ? vec3(.42, .76, .12) : (i < 4.5 ? vec3(.16, .42, .95) : vec3(.6, .28, .9))))); }
void main(){
  vec2 p0 = gl_FragCoord.xy; float li = letter(p0.x), ph = fract(u_time/5. - li*.035), wob = sin(ph*TAU*4.)*exp(-ph*6.);
  vec2 px = vec2(p0.x, u_org.y + (p0.y - u_org.y)/(1. + .075*wob));              /* a letter stretches up from the line it stands on, and settles */
  float a = cov(px); OUTSIDE
  vec3 n = bulge(px, 1.25), base = sweet(li), Hh = normalize(normalize(vec3(-.45, .65, .6)) + vec3(0., 0., 1.));
  float thick = sat(sdh(px).y/.1);
  vec3 col = mix(base*(.62 + .5*(1. - thick)), base*base*.9, thick*.35);         /* light comes through the thin edges and is soaked up in the middle */
  col += pow(sat(dot(n, Hh)), 70.)*.95 + pow(sat(dot(n, Hh)), 8.)*.16 + base*pow(sat(dot(n.xy, vec2(.55, -.7))), 1.5)*.5;
  put(col, a);
}` },

{ name: 'foil', note: 'a holographic sticker. it changes as you move.', still: 3., frag: `
void main(){
  vec2 px = gl_FragCoord.xy; float a = cov(px); OUTSIDE
  vec2 e = em(px); float t = u_time;
  vec2 view = mix(vec2(.5 + .5*sin(t*.37), .5 + .5*cos(t*.29)), (u_ptr - u_org)/u_em/vec2(u_width, .7), u_ptr_on);
  float S = max(.062, 5.*u_dpr/u_em); vec2 q = vec2(e.x - e.y*.57735, e.y*1.1547)/S, id = floor(q), f = fract(q);
  id = id*2. + step(1., f.x + f.y);                                             /* a field of small triangles, each cut at its own angle */
  float ang = hash(id)*TAU, tilt = hash(id + 3.);
  float ph = dot(vec2(cos(ang), sin(ang)), (view - .5)*3.) + tilt*.8 + dot(e, vec2(.35, .2));
  vec3 col = mix(vec3(.58, .6, .68), pal(ph, vec3(.66, .64, .76), vec3(.24, .24, .2), vec3(1.), vec3(0., .33, .67)), .82);
  col += pow(.5 + .5*cos(TAU*(ph*.5 + tilt)), 10.)*.2 + pow(.5 + .5*sin(dot(e, vec2(1.4, 2.2)) - view.x*5. - t*.3), 10.)*.14;
  put(col*(.94 + .06*tilt), a);
}` },

{ name: 'gust', note: 'made of sand. a gust crosses, lifts the grains, and they settle back.', still: .1, frag: `
float blow(float x, float xf){ float b = xf - x; return smoothstep(0., .55, b)*smoothstep(2.2, 1.1, b); }
void main(){
  vec2 px = gl_FragCoord.xy; float u = fract(u_time/9.), xf = mix(-1., u_width + 2.8, u);
  float cs = max(.013*u_em, 1.5*u_dpr); vec2 dir = normalize(vec2(.82, .57));
  float al = cov(px)*step(blow(em(px).x, xf)*1.3, hash(floor(px/cs)));           /* a grain that has not let go stays where it is */
  for (int i = 1; i <= 14; i++){
    float fi = float(i); vec2 src = px - dir*fi*cs*1.5, c = floor(src/cs);
    float fly = max(0., blow(em(src).x, xf)*1.3 - hash(c)), dist = fly*(.45 + hash(c + 9.))*16.;
    al = max(al, step(abs(dist - fi), .5)*step(.001, fly)*step(.5, cov((c + .5)*cs))*(1. - fi/15.));
  }
  put(u_fg, al);
}` },

{ name: 'ripple', note: 'the word on still water, with rain.', still: 3., frag: `
void main(){
  vec2 px = gl_FragCoord.xy; vec2 e = em(px), disp = vec2(0.); float t = u_time, lines = 0.;
  for (int i = 0; i < 4; i++){
    float fi = float(i), T = 5. + fi*1.4, cyc = t/T + fi*.37 + floor(u_seed), k = floor(cyc), age = fract(cyc)*T;
    vec2 d = e - vec2(hash(vec2(k, fi))*u_width, -.1 + .8*hash(vec2(k + 3., fi))); float r = length(d), R = age*.45;
    float off = (r - R)/.17, w = sin((r - R)*36.)*exp(-off*off)*exp(-age*.5)*smoothstep(0., .25, age);
    disp += d/(r + 1e-4)*w*.027; lines += w;
  }
  float a = cov(px + disp*u_em), ring = sat(abs(lines) - .15)*.16;
  vec3 col = mix(vec3(.03, .1, .26), vec3(.8, .9, 1.), u_dark) + mix(vec3(.5, .7, 1.), vec3(-.5, -.35, -.1), u_dark)*lines*.6;
  gl_FragColor = vec4(clamp(col, 0., 1.)*a, a) + vec4(u_fg*ring, ring)*(1. - a);                  /* the rings go on, faintly, over the open page */
}` },
];

/* ------------------------------------------------------------------ measuring the letters */
const INF = 1e20;
function edt1d(f, d, v, z, n) {                        /* one row of the exact distance transform (the lower envelope of parabolas) */
  let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
function edt2d(g, w, h) {                              /* g holds 0 at the places measured from and INF elsewhere; it comes back as squared distances */
  const n = Math.max(w, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; edt1d(f, d, v, z, h); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { const o = y * w; for (let x = 0; x < w; x++) f[x] = g[o + x]; edt1d(f, d, v, z, w); for (let x = 0; x < w; x++) g[o + x] = d[x]; }
}
function soften(a, w, h, passes) {
  const t = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) { const o = y * w; for (let x = 0; x < w; x++) t[o + x] = (a[o + Math.max(0, x - 1)] + 2 * a[o + x] + a[o + Math.min(w - 1, x + 1)]) / 4; }
    for (let y = 0; y < h; y++) { const o = y * w, up = Math.max(0, y - 1) * w, dn = Math.min(h - 1, y + 1) * w; for (let x = 0; x < w; x++) a[o + x] = (t[up + x] + 2 * t[o + x] + t[dn + x]) / 4; }
  }
}
/* From the mask: for every point its distance to the nearest edge of a letter, and the height the letters would have if
   they were blown up (a membrane pinned at the outline, under pressure). Packed two bytes each into one texture. */
function measure(mask, cw, ch, emPx) {
  const sw = Math.min(cw, 1024), k = sw / cw, sh = Math.max(8, Math.round(ch * k)), n = sw * sh, per = emPx * k;      /* per: pixels of this grid in one em */
  const c = document.createElement('canvas'); c.width = sw; c.height = sh; const x2 = c.getContext('2d'); x2.drawImage(mask, 0, 0, sw, sh);
  const A = x2.getImageData(0, 0, sw, sh).data, out = new Float64Array(n), inn = new Float64Array(n);
  for (let i = 0; i < n; i++) { const on = A[i * 4 + 3] > 127; out[i] = on ? 0 : INF; inn[i] = on ? INF : 0; }
  edt2d(out, sw, sh); edt2d(inn, sw, sh);
  const sd = new Float32Array(n);
  for (let i = 0; i < n; i++) { const al = A[i * 4 + 3] / 255; sd[i] = al > .03 && al < .97 ? .5 - al : (al >= .97 ? .5 - Math.sqrt(inn[i]) : Math.sqrt(out[i]) - .5); }
  soften(sd, sw, sh, 1);
  const hw = Math.ceil(sw / 2), hh = Math.ceil(sh / 2), u = new Float32Array(hw * hh), ins = new Uint8Array(hw * hh);
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) { let s = 0, m = 0; for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const xx = x * 2 + dx, yy = y * 2 + dy; if (xx < sw && yy < sh) { s += A[(yy * sw + xx) * 4 + 3]; m++; } } ins[y * hw + x] = s / m > 127 ? 1 : 0; }
  for (let it = 0; it < 90; it++) for (let y = 1; y < hh - 1; y++) { const o = y * hw; for (let x = 1; x < hw - 1; x++) { const i = o + x; if (ins[i]) u[i] += 1.7 * ((u[i - 1] + u[i + 1] + u[i - hw] + u[i + hw] + 1) / 4 - u[i]); } }
  const hg = new Float32Array(n);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const fx = Math.min(hw - 1.001, Math.max(0, (x - .5) / 2)), fy = Math.min(hh - 1.001, Math.max(0, (y - .5) / 2)), x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0, i = y0 * hw + x0;
    hg[y * sw + x] = Math.sqrt(2 * Math.max(0, (u[i] * (1 - ax) + u[i + 1] * ax) * (1 - ay) + (u[i + hw] * (1 - ax) + u[i + hw + 1] * ax) * ay)) * 2 / per;
  }
  soften(hg, sw, sh, 2);
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const s = Math.max(0, Math.min(65535, Math.round((sd[i] / per / .6 + .5) * 65535))), h = Math.max(0, Math.min(65535, Math.round(hg[i] / .25 * 65535)));
    data[i * 4] = s >> 8; data[i * 4 + 1] = s & 255; data[i * 4 + 2] = h >> 8; data[i * 4 + 3] = h & 255;
  }
  return { data, sw, sh };
}
function glyphStrip(cellW, cellH) {
  const set = '.:-=+*x%#&$@', c = document.createElement('canvas'); c.width = cellW * set.length; c.height = cellH; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '700 ' + Math.round(cellH * .82) + 'px "Martian Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace';
  for (let i = 0; i < set.length; i++) x.fillText(set[i], i * cellW + cellW / 2, cellH / 2 + cellH * .04);
  return c;
}

/* ------------------------------------------------------------------ one canvas that can draw any version */
function stage(canvas) {
  let gl = null;
  try { gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true }); } catch (e) {}
  if (!gl) return null;
  let deriv = false, par = null, vs = null, tex = [];
  const progs = new Map();
  function init() {
    progs.clear(); deriv = !!gl.getExtension('OES_standard_derivatives'); par = gl.getExtension('KHR_parallel_shader_compile');
    vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }'); gl.compileShader(vs);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    tex = [gl.LINEAR, gl.NEAREST, gl.LINEAR].map((filter, unit) => {
      const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
      return t;
    });
  }
  init();
  return {
    init,
    lost: () => gl.isContextLost(),
    /* compiling is started here and asked after later, so a slow compiler does not hold the page */
    begin(l) {
      if (progs.has(l.name)) return progs.get(l.name);
      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, (deriv ? '#extension GL_OES_standard_derivatives : enable\n#define DERIV 1\n' : '') + LIB + l.frag); gl.compileShader(fs);
      const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.bindAttribLocation(prog, 0, 'p'); gl.linkProgram(prog);
      const rec = { prog, fs, state: 'pending', U: {}, log: '' }; progs.set(l.name, rec); return rec;
    },
    ready(rec) {
      if (rec.state !== 'pending') return rec.state;
      if (par && !gl.getProgramParameter(rec.prog, par.COMPLETION_STATUS_KHR)) return 'pending';
      if (gl.getProgramParameter(rec.prog, gl.LINK_STATUS)) {
        rec.state = 'ok'; gl.useProgram(rec.prog);
        ['u_mask', 'u_sdf', 'u_glyph'].forEach((n, i) => gl.uniform1i(gl.getUniformLocation(rec.prog, n), i));
      } else { rec.state = 'bad'; rec.log = String(gl.getShaderInfoLog(rec.fs) || '') + String(gl.getProgramInfoLog(rec.prog) || ''); }
      return rec.state;
    },
    image(unit, src) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex[unit]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); },
    bytes(unit, data, w, h) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex[unit]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data); },
    draw(rec, g, o) {
      const U = n => (n in rec.U ? rec.U[n] : (rec.U[n] = gl.getUniformLocation(rec.prog, n)));
      gl.viewport(0, 0, g.cw, g.ch); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(rec.prog);
      gl.uniform2f(U('u_res'), g.cw, g.ch); gl.uniform2f(U('u_org'), g.orgX, g.orgY); gl.uniform1f(U('u_em'), g.emPx); gl.uniform1f(U('u_dpr'), g.dpr); gl.uniform1f(U('u_width'), g.width);
      gl.uniform1fv(U('u_lx[0]'), g.lx); gl.uniform2f(U('u_sres'), g.sw || 1, g.sh || 1); gl.uniform2f(U('u_cell'), g.cellW || 8, g.cellH || 13);
      gl.uniform1f(U('u_time'), o.time); gl.uniform1f(U('u_seed'), o.seed); gl.uniform1f(U('u_dark'), o.dark); gl.uniform3fv(U('u_fg'), o.fg); gl.uniform3fv(U('u_bg'), o.bg);
      gl.uniform2f(U('u_ptr'), o.px, o.py); gl.uniform1f(U('u_ptr_on'), o.pon);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

/* ------------------------------------------------------------------ the wordmark on the page */
const FACE = '900 100px "Albert Sans","Helvetica Neue",Helvetica,Arial,sans-serif';
const hexc = s => { const m = /^#?([0-9a-f]{6})$/i.exec(String(s).trim()); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const named = n => LOGOS.find(l => l.name === n) || null;
/* Which version this load shows: one not seen yet on this device, until all have been, then round again. */
function deal() {
  const all = LOGOS.map(l => l.name); let d = null;
  try { d = JSON.parse(localStorage.getItem('mr-logo')); } catch (e) {}
  let seen = d && Array.isArray(d.seen) ? d.seen.filter(n => all.includes(n)) : [], left = all.filter(n => !seen.includes(n));
  if (!left.length) { seen = []; left = all.filter(n => all.length < 2 || n !== (d && d.last)); }
  const pick = left[Math.floor(Math.random() * left.length)]; seen.push(pick);
  try { localStorage.setItem('mr-logo', JSON.stringify({ seen, last: pick })); } catch (e) {}
  return pick;
}

/* el: the heading. canvas: inside the heading's link, beside the plain text. opts.text: the word. opts.shown(name, number,
   count): called when a version is first on the screen. Until a version has drawn, the plain text stands; if none can be
   drawn here it stays. */
function mount(el, canvas, opts) {
  opts = opts || {};
  const link = canvas.parentNode, mask = document.createElement('canvas'), text = opts.text || 'agentweb';
  const calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const seed = Math.random() * 32, born = performance.now() - Math.random() * 60000;
  let st = null, cur = null, want = null, geo = null, raf = 0, visible = true, last = -1e9, held = null, live = false, told = '', tint = null, started = false, fontsIn = false;
  const failed = new Set(), ptr = { cx: 0, cy: 0, x: 0, y: 0, on: 0, at: -1e9, any: false };

  function colours() {
    const cs = getComputedStyle(document.documentElement), bg = hexc(cs.getPropertyValue('--bg')) || [.965, .965, .957], fg = hexc(cs.getPropertyValue('--fg')) || [.043, .047, .055];
    tint = { bg, fg, dark: bg[0] + bg[1] + bg[2] < 1.2 ? 1 : 0 };
  }
  function layout() {
    const W = Math.max(120, Math.round(el.clientWidth)), dpr = Math.min(2, window.devicePixelRatio || 1), m = mask.getContext('2d');
    m.setTransform(1, 0, 0, 1, 0, 0); m.font = FACE; const adv = []; let width = 0;
    for (const ch of text) { const w = m.measureText(ch).width / 100; adv.push(w); width += w - .045; } width += .045;
    const fs = Math.min((W - 3) / width, 176), H = Math.ceil(fs * .98), B = Math.round(fs * .12), cw = Math.round((W + 2 * B) * dpr), ch = Math.round((H + 2 * B) * dpr);
    canvas.width = mask.width = cw; canvas.height = mask.height = ch;
    Object.assign(canvas.style, { left: -B + 'px', top: -B + 'px', width: (W + 2 * B) + 'px', height: (H + 2 * B) + 'px' });
    m.setTransform(dpr, 0, 0, dpr, 0, 0); m.clearRect(0, 0, W + 2 * B, H + 2 * B); m.fillStyle = '#fff'; m.textBaseline = 'alphabetic'; m.font = FACE.replace('100px', fs + 'px');
    const lx = new Float32Array(13).fill(1e9); let x = B;
    for (let i = 0; i < text.length; i++) { if (i < 13) lx[i] = x * dpr; m.fillText(text[i], x, B + fs * .77); x += (adv[i] - .045) * fs; }
    if (text.length < 13) lx[text.length] = (x + .045 * fs) * dpr;
    const chh = Math.max(4, Math.round(Math.max(.078 * fs * dpr, 7.5 * dpr)));
    geo = { W, H, B, fs, dpr, cw, ch, lx, width, emPx: fs * dpr, orgX: B * dpr, orgY: ch - (B + fs * .77) * dpr, cellH: chh, cellW: Math.max(3, Math.round(chh * .6)), sw: 0, sh: 0, has: {} };
    st.image(0, mask);
    if (live) link.style.height = H + 'px';
  }
  function supply() {                                  /* what the current version asks for beyond the mask */
    if (!cur || !geo) return;
    const needs = cur.needs || '';
    if (needs.includes('sdf') && !geo.has.sdf) { const f = measure(mask, geo.cw, geo.ch, geo.emPx); st.bytes(1, f.data, f.sw, f.sh); geo.sw = f.sw; geo.sh = f.sh; geo.has.sdf = true; }
    if (needs.includes('glyph') && !geo.has.glyph) { st.image(2, glyphStrip(geo.cellW, geo.cellH)); geo.has.glyph = true; }
  }
  function paint(time) {
    const rec = st.begin(cur);
    if (st.ready(rec) !== 'ok') return false;
    let px = -1e5, py = -1e5;
    if (ptr.any && live) { const r = canvas.getBoundingClientRect(); if (r.width) { px = (ptr.x - r.left) / r.width * geo.cw; py = (r.bottom - ptr.y) / r.height * geo.ch; } }
    st.draw(rec, geo, { time, seed, dark: tint.dark, fg: tint.fg, bg: tint.bg, px, py, pon: ptr.on });
    if (!live) { live = true; el.classList.add('is-live'); link.style.height = geo.H + 'px'; }
    el.dataset.logo = cur.name;
    if (told !== cur.name) { told = cur.name; if (opts.shown) { try { opts.shown(cur.name, LOGOS.indexOf(cur) + 1, LOGOS.length); } catch (e) {} } }
    return true;
  }
  function plain() { live = false; el.classList.remove('is-live'); link.style.height = ''; delete el.dataset.logo; }
  function frame(now) {
    raf = 0; if (!st || !cur || !geo) return;
    const state = st.ready(st.begin(cur));
    if (state === 'pending') { raf = requestAnimationFrame(frame); return; }
    if (state === 'bad') {                              /* this version cannot be drawn here: the first one stands in, and if that cannot either, the plain text */
      failed.add(cur.name); const first = LOGOS[0];
      if (failed.has(first.name)) { plain(); return; }
      cur = first; supply(); raf = requestAnimationFrame(frame); return;
    }
    const fresh = now - ptr.at < 2600 ? 1 : 0; ptr.on += (fresh - ptr.on) * .09; ptr.x += (ptr.cx - ptr.x) * .2; ptr.y += (ptr.cy - ptr.y) * .2;
    if (held != null || calm || now - last >= 30) { last = now; paint(held != null ? held : calm ? (cur.still || 3) : (now - born) / 1000); }
    if (held == null && !calm && visible && !document.hidden) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!st) return; colours(); last = -1e9; if (!raf) raf = requestAnimationFrame(frame); };
  function build() { if (!st || !started) return; layout(); supply(); kick(); }
  function show(name) {
    const l = named(name); if (!l) return false;
    want = l; if (!started) return true;
    cur = l; held = null; supply(); kick(); return true;
  }
  function go() {
    if (started) return; started = true;
    cur = want || named(deal()) || LOGOS[0]; colours(); layout(); supply(); kick();
    let rs = 0; const again = () => { clearTimeout(rs); rs = setTimeout(build, 120); };
    window.addEventListener('resize', again);
    if ('ResizeObserver' in window) new ResizeObserver(() => { if (geo && Math.round(el.clientWidth) !== geo.W) again(); }).observe(el);      /* the heading can change width with no resize of the window: a scrollbar arriving, a late stylesheet */
    document.addEventListener('visibilitychange', kick);
    if (window.matchMedia) { const mq = window.matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', kick); }
    new MutationObserver(kick).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    if ('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es[0].isIntersecting; kick(); }).observe(link);
    window.addEventListener('pointermove', e => { ptr.cx = e.clientX; ptr.cy = e.clientY; ptr.at = performance.now(); if (!ptr.any) { ptr.any = true; ptr.x = ptr.cx; ptr.y = ptr.cy; } }, { passive: true });
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); if (raf) cancelAnimationFrame(raf); raf = 0; plain(); });
    canvas.addEventListener('webglcontextrestored', () => { st.init(); failed.clear(); build(); });
  }
  /* The letters are measured at the heading's width and in the page's own face, so nothing is drawn until the page's styles
     have reached the heading and that face is here (or each has had its chance). A script can run before either. */
  function start() {
    st = stage(canvas); if (!st) return;
    const begin = () => { if (!fontsIn) { fontsIn = true; go(); } };
    const face = () => { const fonts = document.fonts; if (!fonts || !fonts.load) { begin(); return; } fonts.load(FACE).then(begin, begin); setTimeout(begin, 900); };
    let waited = 0; const styled = () => { if (parseInt(getComputedStyle(el).fontWeight, 10) >= 800 || ++waited > 180) face(); else requestAnimationFrame(styled); };
    styled();
  }
  const api = {
    start, build, kick, show,
    next() { let n = deal(); if (cur && n === cur.name && LOGOS.length > 1) n = deal(); return show(n); },      /* never the one already on the screen: it may not have come from the deal */
    name: () => (cur ? cur.name : ''),
    /* draw one given moment and stay on it (null lets it run again); true once that moment is on the screen */
    hold(t) { held = t; if (t == null) { kick(); return true; } if (!st || !cur || !geo) return false; colours(); supply(); return paint(t); },
    why: n => { const l = named(n); if (!l || !st) return ''; const rec = st.begin(l); st.ready(rec); return rec.state + ' ' + rec.log; },
  };
  out.mark = api; return api;
}

const out = { LOGOS, mount, mark: null, list: () => LOGOS.map((l, i) => ({ n: i + 1, name: l.name, note: l.note })) };      /* mark: the wordmark that is on the page */
return out;
})();
