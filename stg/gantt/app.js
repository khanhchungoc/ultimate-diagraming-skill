    (function () {
      'use strict';

const TOKENS = {"palette":[{"slot":"1","name":"sky","hex":"#e0f2fe","light":{"soft":"#b9e5ff","strong":"#2f7da8","ink":"#00436a","solid":"#005c8b","on-solid":"#ffffff"},"dark":{"soft":"#194259","strong":"#69b4e2","ink":"#c6eaff","solid":"#93d4fd","on-solid":"#0f172a"}},{"slot":"2","name":"amber","hex":"#fef3c7","light":{"soft":"#ecdeaa","strong":"#907100","ink":"#513a00","solid":"#6f5100","on-solid":"#ffffff"},"dark":{"soft":"#483c06","strong":"#c6a92a","ink":"#f0e5b8","solid":"#e2ca6a","on-solid":"#0f172a"}},{"slot":"3","name":"emerald","hex":"#dcfce7","light":{"soft":"#b9edcb","strong":"#008d4e","ink":"#004e20","solid":"#006c2f","on-solid":"#ffffff"},"dark":{"soft":"#17482e","strong":"#50c586","ink":"#c5f1d5","solid":"#84e2ab","on-solid":"#0f172a"}},{"slot":"4","name":"rose","hex":"#fee2e2","light":{"soft":"#ffcccd","strong":"#b15259","ink":"#6e1724","solid":"#932a37","on-solid":"#ffffff"},"dark":{"soft":"#5c2d2f","strong":"#ee898e","ink":"#ffd5d6","solid":"#ffaeb0","on-solid":"#0f172a"}},{"slot":"5","name":"purple","hex":"#f3e8ff","light":{"soft":"#ead2ff","strong":"#895db0","ink":"#4e276d","solid":"#6b3893","on-solid":"#ffffff"},"dark":{"soft":"#47325a","strong":"#c194eb","ink":"#efdbff","solid":"#deb7ff","on-solid":"#0f172a"}},{"slot":"6","name":"orange","hex":"#ffedd5","light":{"soft":"#fad8ab","strong":"#a66400","ink":"#602f00","solid":"#834300","on-solid":"#ffffff"},"dark":{"soft":"#523709","strong":"#de9c31","ink":"#fde0b9","solid":"#f8bf6c","on-solid":"#0f172a"}},{"slot":"7","name":"teal","hex":"#ccfbf1","light":{"soft":"#aaeee0","strong":"#008f79","ink":"#004f40","solid":"#006d5a","on-solid":"#ffffff"},"dark":{"soft":"#00493f","strong":"#00c7af","ink":"#b9f2e7","solid":"#60e4cf","on-solid":"#0f172a"}},{"slot":"8","name":"indigo","hex":"#e0e7ff","light":{"soft":"#cedcff","strong":"#5b6cc2","ink":"#2a347b","solid":"#3c49a7","on-solid":"#ffffff"},"dark":{"soft":"#313a62","strong":"#8fa4ff","ink":"#d7e3ff","solid":"#b1c5ff","on-solid":"#0f172a"}},{"slot":"9","name":"neutral","light":{"soft":"#e2e8f0","strong":"#64748b","ink":"#334155","solid":"#475569","on-solid":"#ffffff"},"dark":{"soft":"#243049","strong":"#94a3b8","ink":"#e2e8f0","solid":"#cbd5e1","on-solid":"#0f172a"}}],"font":{"metrics":{"label":7.4,"title":7.4,"detail":6.4,"note":6.2,"type":6.6,"edgeLabel":7,"edgeWrap":6.6}},"motion":{"ease":"120ms cubic-bezier(0.2, 0, 0, 1)","dur-micro":"100ms","dur-fast":"140ms","dur-base":"180ms","dur-layout":"230ms","dur-camera":"240ms","dur-tab":"300ms","curve-out":"cubic-bezier(0.22, 1, 0.36, 1)","curve-in":"cubic-bezier(0.4, 0, 1, 1)","curve-inout":"cubic-bezier(0.4, 0, 0.2, 1)","curve-spring-settle":"linear(0, 0.0734, 0.2223, 0.3833, 0.5286, 0.6489, 0.7435, 0.8153, 0.8686, 0.9074, 0.9352, 0.955, 0.9689, 0.9786, 1)","curve-spring-tactile":"linear(0, 0.1021, 0.3124, 0.5352, 0.7235, 0.8616, 0.9511, 1.0018, 1.0252, 1.0315, 1.0288, 1.0223, 1.0152, 1.0092, 1)"},"type":{"fitMin":"11px","fitMinOverview":"9px"},"icon":{"set":"default","size":{"xs":10,"sm":12,"md":14,"lg":18,"xl":22,"tile":32},"stroke":2,"strokeFine":1.75,"strokeBold":2.5,"cap":"round","join":"round"},"c4":{"cardW":156,"cardMaxW":240,"cardH":112,"cardLine":18,"pad":14,"tagH":44,"padB":14,"tagPad":72,"emptyW":200,"emptyH":96,"innerGap":20,"innerLinkX":120,"innerLinkY":64,"ringV":72,"ringH":130,"ringGap":34,"ringLinkX":150,"ringLinkY":90,"ringStagger":6,"ringStaggerCap":12,"centreGap":50,"rowMax":8,"margin":48,"sep":24,"flowAcross":56,"flowAlong":72,"flowPerEdge":10,"flowEdgeCap":8,"flowRowGap":40,"labelMaxW":140}};
const ICONS = {"user":"<path d=\"M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0\"/><path d=\"M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2\"/>","users":"<path d=\"M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0\"/><path d=\"M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2\"/><path d=\"M16 3.13a4 4 0 0 1 0 7.75\"/><path d=\"M21 21v-2a4 4 0 0 0 -3 -3.85\"/>","briefcase":"<path d=\"M3 9a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -9\"/><path d=\"M8 7v-2a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2\"/><path d=\"M12 12l0 .01\"/><path d=\"M3 13a20 20 0 0 0 18 0\"/>","building":"<path d=\"M3 21l18 0\"/><path d=\"M9 8l1 0\"/><path d=\"M9 12l1 0\"/><path d=\"M9 16l1 0\"/><path d=\"M14 8l1 0\"/><path d=\"M14 12l1 0\"/><path d=\"M14 16l1 0\"/><path d=\"M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16\"/>","headset":"<path d=\"M4 14v-3a8 8 0 1 1 16 0v3\"/><path d=\"M18 19c0 1.657 -2.686 3 -6 3\"/><path d=\"M4 14a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-1a2 2 0 0 1 -2 -2v-3\"/><path d=\"M15 14a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-1a2 2 0 0 1 -2 -2v-3\"/>","monitor":"<path d=\"M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-10\"/><path d=\"M7 20h10\"/><path d=\"M9 16v4\"/><path d=\"M15 16v4\"/>","code":"<path d=\"M7 8l-4 4l4 4\"/><path d=\"M17 8l4 4l-4 4\"/><path d=\"M14 4l-4 16\"/>","server":"<path d=\"M3 7a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-2\"/><path d=\"M3 15a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3l0 -2\"/><path d=\"M7 8l0 .01\"/><path d=\"M7 16l0 .01\"/>","database":"<path d=\"M4 6a8 3 0 1 0 16 0a8 3 0 1 0 -16 0\"/><path d=\"M4 6v6a8 3 0 0 0 16 0v-6\"/><path d=\"M4 12v6a8 3 0 0 0 16 0v-6\"/>","cloud":"<path d=\"M6.657 18c-2.572 0 -4.657 -2.007 -4.657 -4.483c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.486c0 1.927 -1.551 3.487 -3.465 3.487h-11.878\"/>","cpu":"<path d=\"M5 6a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1l0 -12\"/><path d=\"M9 9h6v6h-6l0 -6\"/><path d=\"M3 10h2\"/><path d=\"M3 14h2\"/><path d=\"M10 3v2\"/><path d=\"M14 3v2\"/><path d=\"M21 10h-2\"/><path d=\"M21 14h-2\"/><path d=\"M14 21v-2\"/><path d=\"M10 21v-2\"/>","cog":"<path d=\"M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065\"/><path d=\"M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0\"/>","shield":"<path d=\"M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3\"/>","scale":"<path d=\"M7 20l10 0\"/><path d=\"M6 6l6 -1l6 1\"/><path d=\"M12 3l0 17\"/><path d=\"M9 12l-3 -6l-3 6a3 3 0 0 0 6 0\"/><path d=\"M21 12l-3 -6l-3 6a3 3 0 0 0 6 0\"/>","banknote":"<path d=\"M7 15h-3a1 1 0 0 1 -1 -1v-8a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v3\"/><path d=\"M7 10a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v8a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1l0 -8\"/><path d=\"M12 14a2 2 0 1 0 4 0a2 2 0 0 0 -4 0\"/>","credit-card":"<path d=\"M3 8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3l0 -8\"/><path d=\"M3 10l18 0\"/><path d=\"M7 15l.01 0\"/><path d=\"M11 15l2 0\"/>","mail":"<path d=\"M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10\"/><path d=\"M3 7l9 6l9 -6\"/>","package":"<path d=\"M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5\"/><path d=\"M12 12l8 -4.5\"/><path d=\"M12 12l0 9\"/><path d=\"M12 12l-8 -4.5\"/><path d=\"M16 5.25l-8 4.5\"/>","truck":"<path d=\"M5 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0\"/><path d=\"M15 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0\"/><path d=\"M5 17h-2v-11a1 1 0 0 1 1 -1h9v12m-4 0h6m4 0h2v-6h-8m0 -5h5l3 5\"/>","cart":"<path d=\"M4 19a2 2 0 1 0 4 0a2 2 0 1 0 -4 0\"/><path d=\"M15 19a2 2 0 1 0 4 0a2 2 0 1 0 -4 0\"/><path d=\"M17 17h-11v-14h-2\"/><path d=\"M6 5l14 1l-1 7h-13\"/>","clipboard":"<path d=\"M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2\"/><path d=\"M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2\"/><path d=\"M9 12h6\"/><path d=\"M9 16h6\"/>","check":"<path d=\"M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0\"/><path d=\"M9 12l2 2l4 -4\"/>","layers":"<path d=\"M12 4l-8 4l8 4l8 -4l-8 -4\"/><path d=\"M4 12l8 4l8 -4\"/><path d=\"M4 16l8 4l8 -4\"/>","globe":"<path d=\"M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0\"/><path d=\"M3.6 9h16.8\"/><path d=\"M3.6 15h16.8\"/><path d=\"M11.5 3a17 17 0 0 0 0 18\"/><path d=\"M12.5 3a17 17 0 0 1 0 18\"/>","flag":"<path d=\"M5 5a5 5 0 0 1 7 0a5 5 0 0 0 7 0v9a5 5 0 0 1 -7 0a5 5 0 0 0 -7 0v-9\"/><path d=\"M5 21v-7\"/>","undo":"<path d=\"M9 14l-4 -4l4 -4\"/><path d=\"M5 10h11a4 4 0 1 1 0 8h-1\"/>","redo":"<path d=\"M15 14l4 -4l-4 -4\"/><path d=\"M19 10h-11a4 4 0 1 0 0 8h1\"/>","export":"<path d=\"M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2\"/><path d=\"M7 9l5 -5l5 5\"/><path d=\"M12 4l0 12\"/>","save":"<path d=\"M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2\"/><path d=\"M10 14a2 2 0 1 0 4 0a2 2 0 1 0 -4 0\"/><path d=\"M14 4l0 4l-6 0l0 -4\"/>","trash":"<path d=\"M4 7l16 0\"/><path d=\"M10 11l0 6\"/><path d=\"M14 11l0 6\"/><path d=\"M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12\"/><path d=\"M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3\"/>","tidy":"<path d=\"M6 21l15 -15l-3 -3l-15 15l3 3\"/><path d=\"M15 6l3 3\"/><path d=\"M9 3a2 2 0 0 0 2 2a2 2 0 0 0 -2 2a2 2 0 0 0 -2 -2a2 2 0 0 0 2 -2\"/><path d=\"M19 13a2 2 0 0 0 2 2a2 2 0 0 0 -2 2a2 2 0 0 0 -2 -2a2 2 0 0 0 2 -2\"/>","minus":"<path d=\"M5 12l14 0\"/>","plus":"<path d=\"M12 5l0 14\"/><path d=\"M5 12l14 0\"/>","close":"<path d=\"M18 6l-12 12\"/><path d=\"M6 6l12 12\"/>","more":"<path d=\"M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\"/><path d=\"M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\"/><path d=\"M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\"/>","help":"<path d=\"M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0\"/><path d=\"M12 16v.01\"/><path d=\"M12 13a2 2 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483\"/>","import":"<path d=\"M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2\"/><path d=\"M7 11l5 5l5 -5\"/><path d=\"M12 4l0 12\"/>","fit":"<path d=\"M4 8v-2a2 2 0 0 1 2 -2h2\"/><path d=\"M4 16v2a2 2 0 0 0 2 2h2\"/><path d=\"M16 4h2a2 2 0 0 1 2 2v2\"/><path d=\"M16 20h2a2 2 0 0 0 2 -2v-2\"/>","sun":"<path d=\"M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0\"/><path d=\"M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7\"/>","moon":"<path d=\"M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454l0 .008\"/>","key":"<path d=\"M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1 -4.069 0l-.301 -.301l-6.558 6.558a2 2 0 0 1 -1.239 .578l-.175 .008h-1.172a1 1 0 0 1 -.993 -.883l-.007 -.117v-1.172a2 2 0 0 1 .467 -1.284l.119 -.13l.414 -.414h2v-2h2v-2l2.144 -2.144l-.301 -.301a2.877 2.877 0 0 1 0 -4.069l2.643 -2.643a2.877 2.877 0 0 1 4.069 0\"/><path d=\"M15 9h.01\"/>","link":"<path d=\"M9 15l6 -6\"/><path d=\"M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464\"/><path d=\"M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463\"/>","chevron-down":"<path d=\"M6 9l6 6l6 -6\"/>","note-lines":"<path d=\"M4 6l16 0\"/><path d=\"M4 12l10 0\"/><path d=\"M4 18l14 0\"/>","type-erd":"<rect x=\"2.5\" y=\"3\" width=\"10\" height=\"8\" rx=\"1.5\"/><path d=\"M2.5 6.5h10\"/><rect x=\"11.5\" y=\"13\" width=\"10\" height=\"8\" rx=\"1.5\"/><path d=\"M11.5 16.5h10\"/><path d=\"M7.5 11v4.5h4\"/>","table-add":"<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M3 10h18\"/><path d=\"M8 15h8\"/>","relationship":"<path d=\"M3 12h9\"/><path d=\"m12 12 8-5\"/><path d=\"M12 12h8\"/><path d=\"m12 12 8 5\"/><path d=\"M6.5 8v8\"/>","note":"<path class=\"note-paper\" d=\"M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v7l-7 7h-7a2 2 0 0 1 -2 -2z\"/><path class=\"note-fold\" d=\"M13 20v-6a1 1 0 0 1 1 -1h6\"/>","columns":"<path d=\"M13 5h8\"/><path d=\"M13 9h5\"/><path d=\"M13 15h8\"/><path d=\"M13 19h5\"/><path d=\"M3 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4\"/><path d=\"M3 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4\"/>","types":"<path d=\"M7 4a2 2 0 0 0 -2 2v3a2 3 0 0 1 -2 3a2 3 0 0 1 2 3v3a2 2 0 0 0 2 2\"/><path d=\"M17 4a2 2 0 0 1 2 2v3a2 3 0 0 0 2 3a2 3 0 0 0 -2 3v3a2 2 0 0 1 -2 2\"/>","notes":"<path d=\"M5 5a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2l0 -14\"/><path d=\"M9 7l6 0\"/><path d=\"M9 11l6 0\"/><path d=\"M9 15l4 0\"/>","grip":"<path d=\"M8 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\"/><path d=\"M8 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\"/><path d=\"M8 19a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\"/><path d=\"M14 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\"/><path d=\"M14 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\"/><path d=\"M14 19a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\"/>","split":"<path d=\"M2 12h4\"/><circle cx=\"9\" cy=\"12\" r=\"3\"/><circle cx=\"15\" cy=\"12\" r=\"3\"/><path d=\"M18 12h4\"/>","type-flowchart":"<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M3 9h18\"/><path d=\"M3 15h18\"/><path d=\"M9 3v18\"/>","shapes":"<path d=\"M12 3l-4 7h8l-4 -7\"/><path d=\"M14 17a3 3 0 1 0 6 0a3 3 0 1 0 -6 0\"/><path d=\"M4 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4\"/>","chevron-up":"<path d=\"M6 15l6 -6l6 6\"/>","shape-terminator":"<rect x=\"2\" y=\"7\" width=\"20\" height=\"10\" rx=\"5\"/>","shape-process":"<rect x=\"3\" y=\"6\" width=\"18\" height=\"12\" rx=\"2.5\"/>","shape-decision":"<path d=\"M10.7 4.2 3.3 10.8q-1.3 1.2 0 2.4l7.4 6.6q1.3 1.2 2.6 0l7.4-6.6q1.3-1.2 0-2.4L13.3 4.2q-1.3-1.2-2.6 0z\"/>","shape-connector":"<path class=\"tile-line\" d=\"M0.5 12H2M22 12h1.5\"/><path class=\"tile-line tile-gap\" d=\"M10.5 12h3\" stroke-dasharray=\"1 2\"/><circle cx=\"6\" cy=\"12\" r=\"4\"/><circle cx=\"18\" cy=\"12\" r=\"4\"/>","shape-subprocess":"<rect x=\"2\" y=\"6\" width=\"20\" height=\"12\" rx=\"2.5\"/><path class=\"tile-line\" d=\"M6 8.5h1a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1-1.5 1.5h-1a1.5 1.5 0 0 1-1.5-1.5v-1a1.5 1.5 0 0 1 1.5-1.5zM6.5 9.5v2M5.5 10.5h2\"/>","shape-data":"<path d=\"M6 6h16l-4 12H2z\"/>","shape-document":"<path d=\"M3 5h18v11c-3-1.6-6-1.6-9 0s-6 1.6-9 0z\"/>","shape-database":"<path d=\"M4 6.5a8 2.5 0 0 1 16 0v11a8 2.5 0 0 1-16 0z\"/><path class=\"tile-line\" d=\"M4 6.5a8 2.5 0 0 0 16 0\"/>","shape-delay":"<path d=\"M3 6h11a6 6 0 0 1 0 12H3z\"/>","lane":"<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M3 12h18\"/>","direction-tb":"<path d=\"M12 5l0 14\"/><path d=\"M18 13l-6 6\"/><path d=\"M6 13l6 6\"/>","type-sequence":"<rect x=\"3\" y=\"3\" width=\"6\" height=\"4\" rx=\"1\"/><rect x=\"15\" y=\"3\" width=\"6\" height=\"4\" rx=\"1\"/><path d=\"M6 7v14M18 7v14\"/><path d=\"M6 12h12\"/><path d=\"m15 10 3 2-3 2\"/>","focus":"<path d=\"M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\"/><path d=\"M7 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0\"/><path d=\"M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0\"/>","participant":"<rect x=\"4\" y=\"3\" width=\"16\" height=\"6\" rx=\"3\"/><path d=\"M12 9v12\" stroke-dasharray=\"3 3\"/>","message":"<path d=\"M4 12h16\"/><path d=\"m14 6 6 6-6 6\"/>","frame":"<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M3 9h8V4\"/>","numbers":"<path d=\"M10 6h11M10 12h11M10 18h11\"/><path d=\"M4 6h1v4\"/><path d=\"M4 10h2\"/><path d=\"M6 18H4c0-1 2-2 2-3s-1-1.5-2-1\"/>","message-return":"<path d=\"M4 9h16\"/><path d=\"m16 5 4 4-4 4\"/><path d=\"M6 17h10\" stroke-dasharray=\"2 3\"/>","lifespans":"<path d=\"M6 3h12\"/><path d=\"M12 3v14\" stroke-dasharray=\"3 3\"/><path d=\"M8 21h8\"/>","eye":"<path d=\"M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0\"/><path d=\"M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6\"/>","direction-lr":"<path d=\"M5 12l14 0\"/><path d=\"M13 18l6 -6\"/><path d=\"M13 6l6 6\"/>","reverse":"<path d=\"M7 10h14l-4 -4\"/><path d=\"M17 14h-14l4 4\"/>","rename":"<path d=\"M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4\"/><path d=\"M13.5 6.5l4 4\"/>","label":"<path d=\"M4 20l3 0\"/><path d=\"M14 20l7 0\"/><path d=\"M6.9 15l6.9 0\"/><path d=\"M10.2 6.3l5.8 13.7\"/><path d=\"M5 20l6 -16l2 0l7 16\"/>","line-dashed":"<path d=\"M3 12h4\"/><path d=\"M10 12h4\"/><path d=\"M17 12h4\"/>","line-solid":"<path d=\"M3 12h18\"/>","message-async":"<path d=\"M3 12h16\"/><path d=\"m14 7 6 5-6 5\"/>","reply":"<path d=\"M18 18v-6a3 3 0 0 0 -3 -3h-10l4 -4m0 8l-4 -4\"/>","kind-system":"<rect x=\"4\" y=\"6\" width=\"16\" height=\"12\" rx=\"2\"/>","kind-ui":"<rect x=\"3\" y=\"4\" width=\"18\" height=\"12\" rx=\"2\"/><path d=\"M8 20h8M12 16v4\"/>","kind-database":"<ellipse cx=\"12\" cy=\"5\" rx=\"8\" ry=\"3\"/><path d=\"M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5\"/><path d=\"M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3\"/>","kind-queue":"<path d=\"M6 6h12a3 6 0 0 1 0 12H6a3 6 0 0 1 0-12z\"/><path d=\"M18 6a3 6 0 0 0 0 12\"/>","kind-external":"<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18\"/>","auto":"<path d=\"M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4\"/><path d=\"M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4\"/>","actor":"<circle cx=\"12\" cy=\"5\" r=\"3\"/><path d=\"M12 8v7\"/><path d=\"M5 11h14\"/><path d=\"m12 15-5 6\"/><path d=\"m12 15 5 6\"/>","type-usecase":"<circle cx=\"4.5\" cy=\"6.5\" r=\"1.8\"/><path d=\"M4.5 8.3v4.7M2 10.5h5M4.5 13l-2 4.5M4.5 13l2 4.5\"/><ellipse cx=\"15.5\" cy=\"12\" rx=\"6.5\" ry=\"4.5\"/><path d=\"M7.4 10.6 9 11\"/>","usecase":"<rect x=\"2\" y=\"6.5\" width=\"20\" height=\"11\" rx=\"5.5\"/>","subject":"<rect class=\"uc-sub-frame\" x=\"2.5\" y=\"3\" width=\"19\" height=\"18\" rx=\"3\"/><rect class=\"uc-sub-case\" x=\"6.5\" y=\"10\" width=\"11\" height=\"6\" rx=\"3\"/>","clock":"<path d=\"M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0\"/><path d=\"M12 7v5l3 3\"/>","present":"<path d=\"M3 4l18 0\"/><path d=\"M4 4v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-10\"/><path d=\"M12 16l0 4\"/><path d=\"M9 20l6 0\"/><path d=\"M8 12l3 -3l2 2l3 -3\"/>","search":"<path d=\"M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0\"/><path d=\"M21 21l-6 -6\"/>","hash":"<path d=\"M5 9l14 0\"/><path d=\"M5 15l14 0\"/><path d=\"M11 4l-4 16\"/><path d=\"M17 4l-4 16\"/>","queue":"<rect x=\"2\" y=\"7\" width=\"5\" height=\"10\" rx=\"1\"/><rect x=\"9.5\" y=\"7\" width=\"5\" height=\"10\" rx=\"1\"/><path d=\"M17 12h5M19.5 9.5 22 12l-2.5 2.5\"/>","function":"<path d=\"M3 19a2 2 0 0 0 2 2c2 0 2 -4 3 -9s1 -9 3 -9a2 2 0 0 1 2 2\"/><path d=\"M5 12h6\"/><path d=\"M15 12l6 6\"/><path d=\"M15 18l6 -6\"/>","storage":"<path d=\"M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2\"/><path d=\"M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-10\"/><path d=\"M10 12l4 0\"/>","cdn":"<path d=\"M10 19a2 2 0 1 0 -4 0a2 2 0 0 0 4 0\"/><path d=\"M18 5a2 2 0 1 0 -4 0a2 2 0 0 0 4 0\"/><path d=\"M10 5a2 2 0 1 0 -4 0a2 2 0 0 0 4 0\"/><path d=\"M6 12a2 2 0 1 0 -4 0a2 2 0 0 0 4 0\"/><path d=\"M18 19a2 2 0 1 0 -4 0a2 2 0 0 0 4 0\"/><path d=\"M14 12a2 2 0 1 0 -4 0a2 2 0 0 0 4 0\"/><path d=\"M22 12a2 2 0 1 0 -4 0a2 2 0 0 0 4 0\"/><path d=\"M6 12h4\"/><path d=\"M14 12h4\"/><path d=\"M15 7l-2 3\"/><path d=\"M9 7l2 3\"/><path d=\"M11 14l-2 3\"/><path d=\"M13 14l2 3\"/>","gateway":"<path d=\"M21 17h-5.397a5 5 0 0 1 -4.096 -2.133l-.514 -.734a5 5 0 0 0 -4.096 -2.133h-3.897\"/><path d=\"M21 7h-5.395a5 5 0 0 0 -4.098 2.135l-.51 .73a5 5 0 0 1 -4.097 2.135h-3.9\"/><path d=\"M18 10l3 -3l-3 -3\"/><path d=\"M18 20l3 -3l-3 -3\"/>","container":"<path d=\"M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5\"/><path d=\"M12 12l8 -4.5\"/><path d=\"M12 12l0 9\"/><path d=\"M12 12l-8 -4.5\"/>","cluster":"<path d=\"M3 17a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2l0 -2\"/><path d=\"M15 17a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2l0 -2\"/><path d=\"M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2l0 -2\"/><path d=\"M6 15v-1a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v1\"/><path d=\"M12 9l0 3\"/>","cache":"<path d=\"M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11\"/>","lock":"<path d=\"M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6\"/><path d=\"M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0\"/><path d=\"M8 11v-4a4 4 0 1 1 8 0v4\"/>","api":"<path d=\"M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5\"/><path d=\"M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5\"/><path d=\"M3 21l2.5 -2.5\"/><path d=\"M18.5 5.5l2.5 -2.5\"/><path d=\"M10 11l-2 2\"/><path d=\"M13 14l-2 2\"/>","mobile":"<path d=\"M6 5a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2v-14\"/><path d=\"M11 4h2\"/><path d=\"M12 17v.01\"/>","browser":"<path d=\"M4 8h16\"/><path d=\"M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12\"/><path d=\"M8 4v4\"/>","bell":"<path d=\"M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6\"/><path d=\"M9 17v1a3 3 0 0 0 6 0v-1\"/>","type-c4":"<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\" stroke-dasharray=\"3 2\"/><rect x=\"8\" y=\"8\" width=\"8\" height=\"8\" rx=\"1.5\"/><path d=\"M12 3v5M12 16v5\"/>","shape-c4-group":"<rect class=\"c4-grp-frame\" x=\"2.5\" y=\"4\" width=\"19\" height=\"16\" rx=\"3\" stroke-dasharray=\"3 2\"/><rect class=\"c4-grp-tag\" x=\"5\" y=\"6.5\" width=\"7\" height=\"3.5\" rx=\"1\"/>","stream":"<path d=\"M3 12h4l3 8l4 -16l3 8h4\"/>","brain":"<path d=\"M15.5 13a3.5 3.5 0 0 0 -3.5 3.5v1a3.5 3.5 0 0 0 7 0v-1.8\"/><path d=\"M8.5 13a3.5 3.5 0 0 1 3.5 3.5v1a3.5 3.5 0 0 1 -7 0v-1.8\"/><path d=\"M17.5 16a3.5 3.5 0 0 0 0 -7h-.5\"/><path d=\"M19 9.3v-2.8a3.5 3.5 0 0 0 -7 0\"/><path d=\"M6.5 16a3.5 3.5 0 0 1 0 -7h.5\"/><path d=\"M5 9.3v-2.8a3.5 3.5 0 0 1 7 0v10\"/>","chart":"<path d=\"M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z\"/><path d=\"M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z\"/><path d=\"M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z\"/><path d=\"M4 20h14\"/>","sensor":"<path d=\"M18.364 19.364a9 9 0 1 0 -12.728 0\"/><path d=\"M15.536 16.536a5 5 0 1 0 -7.072 0\"/><path d=\"M11 13a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\"/>","workflow":"<rect x=\"4\" y=\"3\" width=\"6\" height=\"4\" rx=\"1\"/><rect x=\"4\" y=\"10\" width=\"6\" height=\"4\" rx=\"1\"/><rect x=\"4\" y=\"17\" width=\"6\" height=\"4\" rx=\"1\"/><rect x=\"14\" y=\"10\" width=\"6\" height=\"4\" rx=\"1\"/><path d=\"M7 7v3\"/><path d=\"M7 14v3\"/><path d=\"M10 12h4\"/>","type-gantt":"<rect x=\"3\" y=\"4\" width=\"10\" height=\"3.5\" rx=\"1.5\"/><rect x=\"8\" y=\"10.25\" width=\"11\" height=\"3.5\" rx=\"1.5\"/><rect x=\"12\" y=\"16.5\" width=\"8\" height=\"3.5\" rx=\"1.5\"/><path d=\"M6 16.5l2 2-2 2-2-2z\"/>","calendar":"<rect x=\"4\" y=\"5\" width=\"16\" height=\"15\" rx=\"2\"/><path d=\"M16 3v4M8 3v4M4 11h16\"/>"};
// --- PLUGIN INTERFACE ---
      // A diagram type registers itself once with registerDiagramPlugin({...}). The shell never touches
      // type internals; it only calls these members:
      //   id, defaultTitle, contentEl (element sized to fit/pan), report {node,label,labelText,nodeText},
      //   render(), isBackground(el), clearSelection(),
      //   cancelInteraction() -> true if something was cancelled, deleteSelection(anchorEl?)
      //   optional: hasSelection() -> true when deleteSelection() would delete something (shows the dock's Delete)
      //   optional: selectInRect(clientRect, mode, start) and selectAll(): multi-select, see SELECTION BOX
      //   optional: onViewChange() after every pan/zoom (body.exporting is set while an export reads styles)
      //   optional: contentOverflow() -> {left, top, right, bottom}: unscaled px that content reaches past
      //             contentEl's edges, so Fit and screenshots frame it too
      //   optional: fitPad(viewportWidth) -> px of margin Fit leaves around the content (default 80), e.g. less on a phone
      //   optional: toDisk(data) -> a new object to write into the page's data block (the disk format: semantic
      //             fields in a fixed order, positions moved out or dropped); must not mutate data
      //   optional: fromDisk(data) -> the in-memory model read from the data block (inverse of toDisk)
      //             Missing members mean the block holds the in-memory model as is. scripts/disk_format.py
      //             does the same in Python; a generated page saved without edits must come out byte-identical.
      // Touch (see TOUCH): a plugin marks selected items with the class `selected` (and anything else a finger may
      // drag right now with the attribute data-touch-drag). A one-finger touch reaches the plugin only when it lands
      // inside such an element; any other touch pans, and a tap is replayed to the
      // item as a synthetic pointerdown + pointerup, so selecting on pointerdown keeps working.
      // Undo/redo is the shell's job: every updateStatus(true) records a snapshot of chartData, so a plugin
      // gets undo for free as long as it calls updateStatus(true) once per finished edit (not per pointermove).
      // The type's engine.js must define layoutDiagram(data): lay out `data` in place, no DOM access.
      // Shared scope for plugins: chartData, scale/panX/panY, viewport, stage, updateStatus(), fitView().
      let plugin = null;
      function registerDiagramPlugin(p) { plugin = p; if (typeof syncCopyMenu === 'function') syncCopyMenu(); }

      // --- SWATCHES: the colours a flowchart lane, a sequence participant or frame, or an ERD table may carry ---
      // Diagram data stores a palette slot ("1".."9", TOKENS.palette from assets/tokens/default.json) or a custom hex. A
      // slot's shades are fixed tokens (--sw-<slot>-*, generated by scripts/tokens.py); setSwatch() points an element at
      // its slot, and a custom hex is derived at run time (see shell.css). Older diagrams stored the slot's `hex` (and
      // frames a colour name): colorSlot() maps those to the slot. Mirrors color_slot() in scripts/disk_format.py.
      const PALETTE = TOKENS.palette;
      const SWATCHES = PALETTE.filter((s) => s.hex); // the picker: slots 1-8; slot 9 is the neutral grey (frames)
      const OLD_FRAME_COLORS = { blue: 'sky', green: 'emerald', yellow: 'amber', red: 'rose', purple: 'purple', gray: 'neutral' };
      function colorSlot(v) {
        const k = typeof v === 'string' ? v.toLowerCase() : v;
        const w = PALETTE.find((q) => q.slot === k || q.hex === k || q.name === OLD_FRAME_COLORS[k]);
        return w ? w.slot : v;
      }
      const paletteOf = (v) => PALETTE.find((w) => w.slot === colorSlot(v));
      const swatchSlot = (v) => (paletteOf(v) || {}).slot;
      // A colour key's keys as slots (an old hex key never replaces a slot key)
      function colorKeySlots(key) {
        const out = {};
        Object.keys(key || {}).forEach((k) => { const s = colorSlot(k); if (!(s in out)) out[s] = key[k]; });
        return out;
      }
      // In place: `color` of every object in the named lists of a diagram, and its colorKey, as slots (see slot_colors in disk_format.py)
      function slotColors(d, ...lists) {
        lists.forEach((n) => (d[n] || []).forEach((o) => { if (o && 'color' in o) o.color = colorSlot(o.color); }));
        if (d.colorKey && typeof d.colorKey === 'object' && !Array.isArray(d.colorKey)) d.colorKey = colorKeySlots(d.colorKey);
      }
      // Colour `el` with a slot or custom hex: a swatch-scope element reading its slot's shades, or the run-time derivation for a custom hex.
      function setSwatch(el, v) {
        const w = paletteOf(v);
        el.classList.add('swatch-scope');
        const hex = w ? w.hex : v;
        if (hex) el.style.setProperty('--swatch-color', hex); else el.style.removeProperty('--swatch-color');
        if (w) el.dataset.sw = w.slot; else delete el.dataset.sw;
      }
      // A row of colour buttons: "none", then each swatch. `current` is the slot or custom hex now in use (or empty); onPick(slot)
      // gets the chosen slot, or '' for none (opts.white, a hex, makes that first button a real white instead). opts.btnClass adds a class to every button. Returns the row element.
      function swatchRow(current, onPick, opts) {
        const row = document.createElement('span');
        row.className = 'swatch-row';
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', 'Colour');
        const now = current ? colorSlot(current) : '';
        [{ slot: (opts && opts.white) || '', name: opts && opts.white ? 'white' : 'none' }].concat(PALETTE).forEach((sw) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `swatch-btn${opts && opts.btnClass ? ' ' + opts.btnClass : ''}`;
          b.dataset.value = sw.slot;
          b.title = sw.slot || sw.name === 'white' ? `Colour: ${sw.name}` : 'No colour';
          b.setAttribute('aria-label', b.title);
          b.setAttribute('aria-pressed', String(now === sw.slot));
          const dot = document.createElement('span');
          dot.className = sw.slot ? 'swatch-dot' : 'swatch-dot is-none';
          if (sw.slot) setSwatch(dot, sw.slot);   // opts.white: the first button is a real white (a type whose default is a colour by position)
          b.appendChild(dot);
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            row.querySelectorAll('.swatch-btn[aria-pressed="true"]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
            b.setAttribute('aria-pressed', 'true');
            onPick(sw.slot);
          });
          row.appendChild(b);
        });
        return row;
      }
      // A single colour-dot button that opens a popover with swatchRow() on click.
      // opts: { btnClass, triggerClass, act, white }
      function swatchPicker(current, onPick, opts) {
        const o = opts || {};
        const picker = document.createElement('span');
        picker.className = 'swatch-picker';
        const trig = document.createElement('button');
        trig.type = 'button';
        trig.className = `${o.triggerClass || 'ab-btn'} swatch-trigger`;
        trig.setAttribute('aria-haspopup', 'true');
        trig.setAttribute('aria-expanded', 'false');
        const dot = document.createElement('span');
        const syncTrigger = (val) => {
          const slot = val ? colorSlot(val) : '';
          const w = slot ? paletteOf(slot) : null;
          dot.className = slot ? 'swatch-dot' : 'swatch-dot is-none';
          if (slot) setSwatch(dot, slot);
          else { dot.style.removeProperty('--swatch-color'); delete dot.dataset.sw; dot.classList.remove('swatch-scope'); }
          const label = w ? `Colour: ${w.name}` : (o.white && slot === o.white ? 'Colour: white' : 'Colour: none');
          trig.title = label;
          trig.setAttribute('aria-label', label);
        };
        syncTrigger(current);
        trig.appendChild(dot);
        const caret = document.createElement('span');
        caret.className = 'swatch-caret-wrap';
        caret.innerHTML = ui.icon('chevron-down', { size: 'xs', bold: true });
        const caretSvg = caret.querySelector('svg');
        if (caretSvg) caretSvg.classList.add('swatch-caret');
        trig.appendChild(caret);

        const pop = document.createElement('div');
        pop.className = 'swatch-popover';
        pop.hidden = true;
        let offDoc = null;
        const close = (restoreFocus) => {
          if (pop.hidden) return;
          const above = pop.classList.contains('is-above');
          if (typeof motion !== 'undefined' && motion.enabled()) {
            motion.ghostExit(pop, {
              duration: 100,
              transform: `scale(0.92, 0.86) translateY(${above ? 4 : -4}px)`,
              clipPath: above ? 'inset(25% 0 0 0 round 8px)' : 'inset(0 0 25% 0 round 8px)',
              origin: above ? 'bottom center' : 'top center'
            });
          }
          pop.hidden = true;
          pop.classList.remove('is-above');
          pop.style.removeProperty('--pop-shift');
          trig.setAttribute('aria-expanded', 'false');
          if (offDoc) { offDoc(); offDoc = null; }
          if (restoreFocus && trig.isConnected) trig.focus();
        };
        const row = swatchRow(current, (slot) => {
          syncTrigger(slot);
          close(true);
          onPick(slot);
        }, o);
        if (o.act) row.querySelectorAll('.swatch-btn').forEach((b) => { b.dataset.act = o.act; });
        pop.appendChild(row);
        picker.append(trig, pop);

        const open = () => {
          document.querySelectorAll('.swatch-popover:not([hidden])').forEach((el) => {
            if (el !== pop && el._closeSwatchPop) el._closeSwatchPop(false);
          });
          pop.hidden = false;
          pop.classList.remove('is-above');
          pop.style.removeProperty('--pop-shift');
          trig.setAttribute('aria-expanded', 'true');
          const bar = picker.closest('.actionbar, .uc-actionbar, .erd-actionbar, .seq-actionbar');
          const preferAbove = !(bar && bar.classList.contains('is-below'));
          const r = pop.getBoundingClientRect();
          const tr = trig.getBoundingClientRect();
          const pad = 8;
          const hasRoomAbove = tr.top - r.height - 6 > ui.chromeTop() + pad;
          const hasRoomBelow = r.bottom <= window.innerHeight - pad;
          if ((preferAbove && hasRoomAbove) || (!preferAbove && !hasRoomBelow && hasRoomAbove)) {
            pop.classList.add('is-above');
          }
          const r2 = pop.getBoundingClientRect();
          let shift = 0;
          if (r2.left < pad) shift = pad - r2.left;
          else if (r2.right > window.innerWidth - pad) shift = (window.innerWidth - pad) - r2.right;
          if (shift) {
            const uiScale = bar ? (parseFloat(getComputedStyle(bar).getPropertyValue('--ui-scale')) || 1) : 1;
            pop.style.setProperty('--pop-shift', `${Math.round(shift / uiScale)}px`);
          }
          const above = pop.classList.contains('is-above');
          if (typeof motion !== 'undefined' && motion.enabled()) {
            motion.anim(pop, [
              { transform: `scale(0.92, 0.86) translateY(${above ? 4 : -4}px)`, clipPath: above ? 'inset(25% 0 0 0 round 8px)' : 'inset(0 0 100% 0 round 8px)' },
              { transform: 'none', clipPath: 'inset(0 0 0 0 round 8px)' }
            ], { duration: 130, easing: motion.curve('curve-out') });
          }
          const active = row.querySelector('.swatch-btn[aria-pressed="true"]') || row.querySelector('.swatch-btn');
          if (active) active.focus();
          const onDocPointer = (e) => {
            if (!picker.isConnected) { close(false); return; }
            if (!picker.contains(e.target)) close(false);
          };
          const onDocKey = (e) => {
            if (!picker.isConnected) { close(false); return; }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
          };
          document.addEventListener('pointerdown', onDocPointer, true);
          document.addEventListener('keydown', onDocKey, true);
          offDoc = () => {
            document.removeEventListener('pointerdown', onDocPointer, true);
            document.removeEventListener('keydown', onDocKey, true);
          };
        };
        pop._closeSwatchPop = close;

        trig.addEventListener('pointerdown', (e) => e.stopPropagation());
        trig.addEventListener('click', (e) => {
          e.stopPropagation();
          if (pop.hidden) open(); else close(false);
        });
        pop.addEventListener('pointerdown', (e) => e.stopPropagation());
        pop.addEventListener('keydown', (e) => {
          const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? 5 : e.key === 'ArrowUp' ? -5 : 0;
          if (step) {
            const btns = [...row.querySelectorAll('.swatch-btn')];
            const idx = btns.indexOf(document.activeElement);
            if (idx === -1) return;
            e.preventDefault();
            e.stopPropagation();
            btns[(idx + step + btns.length) % btns.length].focus();
          } else if (e.key === 'Tab') {
            close(false);
          }
        });
        return picker;
      }

      // --- UI BUILDERS: markup every diagram type shares (styled by assets/components/*.css) ---
      // A type calls these instead of building the same elements itself; it keeps only what is specific to it.
      const ui = (() => {
        // An icon by name from the registry (ICONS, assets/icons/default.json): the <svg> text, drawn with the icon tokens
        // (TOKENS.icon). o: { size: a token name (xs sm md lg xl tile; default md) or a px number, fine: the thinner stroke for
        // dense or large icons, bold: the heavier stroke for tiny ones, class }. Templates write the icon placeholder instead;
        // scripts/tokens.py icon_svg() builds the same text. Colour is currentColor, so icons follow the text colour.
        function icon(name, o) {
          const t = TOKENS.icon, inner = ICONS[name], opts = o || {};
          if (inner === undefined) throw new Error(`unknown icon "${name}"`);
          const px = typeof opts.size === 'number' ? opts.size : t.size[opts.size || 'md'];
          const cls = opts.class ? ` class="${opts.class}"` : '';
          if (inner && typeof inner === 'object') {
            return `<svg${cls} width="${px}" height="${px}" viewBox="${inner.vb}" fill="currentColor" aria-hidden="true">${inner.body}</svg>`; // tokens-ok: this is the icon renderer
          }
          const stroke = opts.bold ? t.strokeBold : opts.fine ? t.strokeFine : t.stroke;
          return `<svg${cls} width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="${t.cap}" stroke-linejoin="${t.join}" aria-hidden="true">${inner}</svg>`; // tokens-ok: this is the icon renderer
        }
        // A logo of a local icon pack (LOGOS, embedded by the build from icons/<pack>.json; name is "<pack>/<icon>"): the filled,
        // multi-colour <svg> text. Colours and aspect ratio stay as the vendor drew them (the viewBox fits it in a square of
        // the same sizes as icon(); no recolouring, no stretch). o: { size, class }. scripts/tokens.py logo_svg() builds the same text.
        function logo(name, o) {
          const e = typeof LOGOS === 'undefined' ? undefined : LOGOS[name], opts = o || {};
          if (e === undefined) throw new Error(`unknown logo "${name}"`);
          const px = typeof opts.size === 'number' ? opts.size : TOKENS.icon.size[opts.size || 'md'];
          return `<svg${opts.class ? ` class="${opts.class}"` : ''} width="${px}" height="${px}" viewBox="${e.vb}" aria-hidden="true">${e.body}</svg>`;
        }
        function iconEl(name, o) {
          const tpl = document.createElement('template');
          tpl.innerHTML = icon(name, o);
          return tpl.content.firstChild;
        }
        let confirmEl = null;
        function closeConfirm() {
          if (!confirmEl) return false;
          if (typeof motion !== 'undefined') motion.ghostExit(confirmEl, { duration: 110, transform: 'scale(0.92) translateY(4px)' });
          confirmEl.remove();
          confirmEl = null;
          document.removeEventListener('pointerdown', onConfirmOutside, true);
          return true;
        }
        function onConfirmOutside(e) { if (confirmEl && !confirmEl.contains(e.target)) closeConfirm(); }
        // Ask before a delete: a bubble under `anchor` (a DOM element; above it when there is no room below; the upper middle
        // of the window when null), kept on screen. opts: { message, title?, label (the dialog's aria-label), ok? (button text,
        // "Delete"), okClass? (the main button's style, "btn-danger"), extra? (a DOM node shown under the message) }.
        // Escape, Cancel, a click elsewhere or a pan/zoom (the type calls closeConfirm) dismisses it.
        function confirm(anchor, opts, onYes) {
          closeConfirm();
          const box = document.createElement('div');
          box.className = 'confirm';
          box.dataset.exportSkip = '';
          box.setAttribute('role', 'alertdialog');
          box.setAttribute('aria-label', opts.label);
          const add = (cls, text) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; box.appendChild(d); };
          if (opts.title) add('confirm-title', opts.title);
          add('confirm-msg', opts.message);
          if (opts.extra) box.appendChild(opts.extra);
          const row = document.createElement('div');
          row.className = 'confirm-actions';
          const button = (cls, text) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; return b; };
          const cancel = button('btn confirm-cancel', 'Cancel');
          cancel.addEventListener('click', () => closeConfirm());
          const ok = button(`btn ${opts.okClass || 'btn-danger'} confirm-ok`, opts.ok || 'Delete');
          ok.addEventListener('click', () => { closeConfirm(); onYes(); });
          row.append(cancel);
          // An optional milder second choice (opts.alt: { text, onClick }) between Cancel and the main action
          if (opts.alt) {
            box.classList.add('has-alt');   // three buttons: a wider bubble
            const alt = button('btn confirm-alt', opts.alt.text);
            alt.addEventListener('click', () => { closeConfirm(); opts.alt.onClick(); });
            row.append(alt);
          }
          row.append(ok);
          box.appendChild(row);
          box.addEventListener('keydown', (e) => {
            // Keys inside the bubble stay there (Delete/Backspace would open it again)
            if (e.key === 'Escape') { e.preventDefault(); closeConfirm(); }
            if (e.key !== 'Tab') e.stopPropagation();
          });
          document.body.appendChild(box);
          confirmEl = box;
          const r = anchor ? anchor.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 3, bottom: innerHeight / 3 };
          const bw = box.offsetWidth, bh = box.offsetHeight;
          const top = r.bottom + 8 + bh > innerHeight - 8 ? r.top - 8 - bh : r.bottom + 8;
          box.style.left = `${Math.max(8, Math.min(r.left, innerWidth - bw - 8))}px`;
          box.style.top = `${Math.max(8, Math.min(top, innerHeight - bh - 8))}px`;
          if (typeof motion !== 'undefined' && motion.enabled()) {
            const above = top < r.top;
            motion.anim(box, [
              { transform: `scale(0.92) translateY(${above ? 4 : -4}px)`, clipPath: `inset(${above ? '20% 0 0 0' : '0 0 20% 0'} round 10px)` },
              { transform: 'none', clipPath: 'inset(0 0 0 0 round 10px)' }
            ], { duration: motion.dur('dur-base', 160), easing: motion.curve('curve-spring-tactile') });
          }
          cancel.focus();
          document.addEventListener('pointerdown', onConfirmOutside, true);
        }
        // A note card: `.note` with its plain-text `.note-text`, and (when given) the delete and link chips. note: { id, text }.
        // o: { onDelete?, onLink?(pointerdown event, card), linkTitle?, onCommit?(note text element)
        // (Enter, Ctrl+Enter, Esc finish editing), onInput? }. Returns { card, text }; the caller adds its own pointer handlers.
        function noteCard(note, o) {
          const card = document.createElement('div');
          card.className = 'note';
          card.dataset.noteId = note.id;
          const text = document.createElement('div');
          text.className = 'note-text';
          text.spellcheck = false;
          text.dataset.placeholder = 'Add a note…';
          text.textContent = note.text || '';
          card.appendChild(text);
          const tool = (cls, title, icon) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = cls;
            b.title = title;
            b.setAttribute('aria-label', title);
            b.setAttribute('data-export-skip', '');
            b.innerHTML = icon;
            card.appendChild(b);
            return b;
          };
          if (o.onDelete) {
            const del = tool('note-del btn-danger-hover', 'Delete note', icon('close', { size: 'xs', bold: true }));
            del.addEventListener('pointerdown', (e) => e.stopPropagation());
            del.addEventListener('click', (e) => { e.stopPropagation(); o.onDelete(); });
          }
          if (o.onLink) {
            const link = tool('note-link', o.linkTitle, icon('link', { size: 'sm', bold: true }));
            link.addEventListener('pointerdown', (e) => o.onLink(e, card));
            link.addEventListener('click', (e) => e.stopPropagation());
          }
          if (o.onCommit) {
            // Plain text only. Enter starts a new line; Ctrl/Cmd+Enter, Esc or clicking away finishes.
            text.addEventListener('paste', (e) => {
              e.preventDefault();
              document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
            });
            text.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) {
                e.preventDefault();   // a plain line break, not the <div> the browser would wrap the new line in
                document.execCommand('insertLineBreak');
              } else if (e.key === 'Escape' || e.key === 'Enter') {
                // Commit directly too: blur() fires no blur event while the window itself is not focused
                e.preventDefault(); e.stopPropagation(); text.blur(); o.onCommit(text);
              }
            });
          }
          if (o.onInput) text.addEventListener('input', o.onInput);
          return { card, text };
        }
        // The action bar over a selection (never exported, never in ?present: the type hides it there). `cls` is the bar's own
        // class and the button class `ab-btn` / `ab-sep` follow the type's naming when it passes them (the ERD and the sequence
        // keep their `erd-` and `seq-` classes); the flowchart uses the shared `actionbar`, `ab-btn` and `ab-sep`
        // (components/actionbar.css). abButton: act and value go in data-act / data-value; pressed (when not undefined) in aria-pressed.
        function actionBar(cls, label) {
          const bar = document.createElement('div');
          bar.className = cls;
          bar.dataset.exportSkip = '';
          bar.setAttribute('role', 'toolbar');
          if (label) bar.setAttribute('aria-label', label);
          // The show / hide chevron, first in every bar: one switch for all bars (body.bars-collapsed hides all but the chevron)
          const t = document.createElement('button');
          t.type = 'button';
          t.className = 'ab-toggle';
          t.innerHTML = icon('chevron-down', { size: 'xs', bold: true });
          t.addEventListener('pointerdown', (e) => e.stopPropagation());
          t.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.swatch-popover:not([hidden])').forEach((el) => { if (el._closeSwatchPop) el._closeSwatchPop(false); });
            // Every bar on the page morphs from its old box to its new one (motion kernel: ghostMorph)
            const bars = [...document.querySelectorAll('.actionbar, .uc-actionbar, .erd-actionbar, .seq-actionbar')];
            const was = bars.map((b) => b.getBoundingClientRect());
            document.body.classList.toggle('bars-collapsed');
            document.querySelectorAll('.ab-toggle').forEach(syncToggle);
            bars.forEach((b, i) => { if (b.classList.contains('is-wrap')) fitBar(b); motion.ghostMorph(was[i], b, 170, 'curve-spring-settle'); });
          });
          syncToggle(t);
          bar.appendChild(t);
          return bar;
        }
        function syncToggle(t) {
          const off = document.body.classList.contains('bars-collapsed');
          t.title = off ? 'Show the action bar' : 'Hide the action bar';
          t.setAttribute('aria-label', t.title);
          t.setAttribute('aria-expanded', String(!off));
        }
        function abButton(cls, act, html, title, pressed, value, extra) {
          const b = document.createElement('button');
          b.className = extra ? `${cls} ${extra}` : cls;
          b.type = 'button';
          b.dataset.act = act;
          if (value !== undefined) b.dataset.value = value;
          b.title = title;
          b.setAttribute('aria-label', title);
          if (pressed !== undefined) b.setAttribute('aria-pressed', String(!!pressed));
          b.innerHTML = html;
          return b;
        }
        const abSep = (cls) => { const s = document.createElement('span'); s.className = cls || 'ab-sep'; return s; };
        const abBreak = (cls) => { const s = document.createElement('span'); s.className = cls || 'ab-break'; return s; };
        // The size a bar has when expanded, even while the bars are collapsed (a bar is placed for its full size, so showing the
        // bars again never puts one over its anchor)
        function barSize(bar) {
          const off = document.body.classList.contains('bars-collapsed');
          if (off) document.body.classList.remove('bars-collapsed');
          const size = { w: bar.offsetWidth, h: bar.offsetHeight };
          if (off) document.body.classList.add('bars-collapsed');
          return size;
        }
        function chromeTop() {
          if (document.body.classList.contains('capture') || document.body.classList.contains('exporting')) return 0;
          const vp = document.getElementById('viewport');
          const vpTop = vp ? vp.getBoundingClientRect().top : 0;
          let bottom = vpTop;
          if (!document.body.classList.contains('presentation')) {
            const hdr = document.querySelector('header');
            if (hdr) hdr.querySelectorAll('.toolbar-left, .toolbar-right').forEach((el) => {
              const r = el.getBoundingClientRect();
              if (r.height > 0 && r.width > 0) bottom = Math.max(bottom, r.bottom);
            });
          }
          const tabs = document.querySelector('.flow-tabs');
          if (tabs && getComputedStyle(tabs).display !== 'none' && !tabs.hidden) {
            const r = tabs.getBoundingClientRect();
            if (r.height > 0 && r.width > 0) bottom = Math.max(bottom, r.bottom);
          }
          return Math.max(0, bottom - vpTop);
        }
        // Does an action bar fit above `anchor` (an element or rect on screen) inside the viewport? Every type decides over or
        // under its element with this, by where the element is in the window, not in the diagram. A bar is not zoomed (--ui-scale).
        function roomAbove(anchor, bar) {
          const top = (anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor).top;
          return top - (document.getElementById('viewport').getBoundingClientRect().top + chromeTop()) >= barSize(bar).h + 16;
        }
        // A wrapped bar (is-wrap, rows split by a `-ab-break` item) is as wide as its widest row, not as its max-width: call
        // it once the bar is in the page. No empty side padding, and a row that fits never wraps on its own.
        function fitBar(bar) {
          const kids = [...bar.children].filter((k) => !/(^|-)ab-break$|(^| )ab-toggle$/.test(k.className));   // not the corner chevron
          if (!kids.length) return;
          // measured expanded and unclamped, whatever the state: a bar built (or shown again) while the bars are collapsed must not be squeezed
          const off = document.body.classList.contains('bars-collapsed');
          if (off) document.body.classList.remove('bars-collapsed');
          bar.style.maxWidth = '';
          const l = Math.min(...kids.map((k) => k.offsetLeft)), r = Math.max(...kids.map((k) => k.offsetLeft + k.offsetWidth));
          const cs = getComputedStyle(bar), edge = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
          bar.style.maxWidth = `${Math.ceil(r - l + edge) + 2}px`;   // +2: fractional text widths must not tip a full row into wrapping
          if (off) document.body.classList.add('bars-collapsed');
        }
        // The colour legend: one entry per colour in `used` (slots), a dot and its label from `key` ({slot: text}). An entry
        // with no label is drawn only with opts.prompts (a prompt "What does Blue mean?" for the edit, left out of ?present and
        // exports). opts.cls adds a class to the legend (the type positions it). The label span carries data-color for the
        // type's own edit. Returns the element, or null when no entry is drawn.
        function colorKey(used, key, opts) {
          const o = opts || {};
          const items = used.filter((c) => o.prompts || (key && key[c]));
          if (!items.length) return null;
          const box = document.createElement('div');
          box.className = `color-key${o.cls ? ' ' + o.cls : ''}`;
          items.forEach((color) => {
            const label = (key && key[color]) || '';
            const item = document.createElement('div');
            item.className = `color-key-item${label ? '' : ' is-unnamed'}`;
            const dot = document.createElement('span');
            dot.className = 'color-key-dot';
            setSwatch(dot, color);
            item.appendChild(dot);
            const text = document.createElement('span');
            text.className = `color-key-label${label ? '' : ' is-empty'}`;
            text.dataset.color = color;
            if (!label) text.dataset.hint = `What does ${(paletteOf(color) || {}).name || color} mean?`;
            text.textContent = label;
            item.appendChild(text);
            box.appendChild(item);
          });
          return box;
        }
        return { confirm, closeConfirm, isConfirmOpen: () => !!confirmEl, noteCard, actionBar, abButton, abSep, abBreak, chromeTop, roomAbove, barSize, fitBar, colorKey, icon, iconEl, logo, hasLogo: (n) => typeof LOGOS !== 'undefined' && LOGOS[n] !== undefined, toast: (m) => showToast(m) };
      })();

      // --- ENGINE SOURCE (for plugins that run a background Web Worker, e.g. ERD) ---
      // Captured synchronously while this script runs so both inline <script> and external <script src="app.js">
      // work without plugins knowing how scripts or artifacts are packaged.
      const currentScriptEl = document.currentScript;
      function sliceEngineSource(text) {
        const a = text.indexOf('//@engine' + '-begin');
        if (a < 0) return '';
        const b = text.indexOf('//@engine' + '-end', a);
        return b < 0 ? '' : text.slice(a, b);
      }
      let cachedEngineSrc = currentScriptEl && currentScriptEl.textContent
        ? sliceEngineSource(currentScriptEl.textContent)
        : '';
      const engineSrcPromise = !cachedEngineSrc && currentScriptEl && currentScriptEl.src
        ? fetch(currentScriptEl.src)
            .then((r) => (r.ok ? r.text() : ''))
            .then((text) => { cachedEngineSrc = sliceEngineSource(text); }, () => '')
        : null;
      function loadEngineSource() { return cachedEngineSrc; }

      // --- CLAUDE.AI ARTIFACT (only active inside a published claude.ai artifact; elsewhere none of this runs) ---
      // A page that republishes itself must send a document in exactly the shape the Artifact tool publishes:
      // this skeleton, the page content, then the closing tags (nothing else in <head>, no whitespace between its
      // tags). ARTIFACT_RESET_CSS / ARTIFACT_HEAD mirror ARTIFACT_RESET_CSS / ARTIFACT_HEAD in scripts/layout_engine.py;
      // dev/check_artifact_shape.py fails if the two differ.
      // The RESET text is copied byte for byte from a published artifact (verified 2026-11-14, runtime contract 0.2.96).
      const ARTIFACT_RESET_CSS = ':root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}'; // tokens-ok: the platform's own reset, copied byte for byte
      const ARTIFACT_HEAD = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>' + ARTIFACT_RESET_CSS + '</style></head><body>';
      const ARTIFACT_TAIL = '</body></html>';
      // = ARTIFACT_END_MARKER in layout_engine.py; spelled in two parts so this script's own text never matches it
      const ARTIFACT_END_MARKER = '<!-- end ultimate-diagram ' + 'page -->';

      // An artifact page has <title> as a direct child of <body>; a plain file keeps it in <head>.
      const artifactShaped = !!(document.body && document.body.querySelector(':scope > title'));
      const hasInlineData = !!document.getElementById('diagram-data');
      let capturedThemeJson = null;
      let capturedFontLinks = '';
      let pristineScaffoldHtml = null;
      let pristineBody = null;

      // Legacy fallback: pristine copy of an inline single-file artifact page, captured before first render.
      function capturePristineBody() {
        try {
          const self = currentScriptEl;
          const c = document.body.cloneNode(true);
          c.querySelectorAll(':scope > meta, :scope > base').forEach(n => n.remove());
          c.querySelectorAll('script').forEach(n => {
            if ((n.id === 'diagram-data' || n.id === 'diagram-theme') && n.type === 'application/json') return;
            if (self && !n.id && !n.src && n.textContent === self.textContent) return;
            n.remove();
          });
          // An artifact page has <title> as the first element of <body>; a plain file keeps it in <head>
          const title = c.querySelector(':scope > title');
          if (!title) return null;
          while (c.firstChild !== title) c.removeChild(c.firstChild);
          const html = c.innerHTML;
          const end = html.lastIndexOf('<\/script>');   // spelled <\/ so this inline script is not cut short
          if (end < 0) return null;
          return '\n' + html.slice(0, end + '<\/script>'.length) + '\n' + ARTIFACT_END_MARKER + '\n';
        } catch (_) { return null; }
      }

      // Capture unrendered body markup, stored theme JSON, and Google Fonts links before plugin.render() mutates the DOM.
      function captureArtifactScaffold() {
        if (!artifactShaped) return;
        if (hasInlineData) pristineBody = capturePristineBody();
        try {
          const c = document.body.cloneNode(true);
          c.querySelectorAll(':scope > meta, :scope > base').forEach(n => n.remove());
          const title = c.querySelector(':scope > title');
          while (title && c.firstChild !== title) c.removeChild(c.firstChild);
          const themeEl = c.querySelector('script#diagram-theme[type="application/json"]');
          if (themeEl && themeEl.textContent.trim()) capturedThemeJson = themeEl.textContent;
          c.querySelectorAll('script').forEach(n => n.remove());
          const fontLinks = [];
          c.querySelectorAll('link').forEach(n => {
            const href = n.getAttribute('href') || '';
            const rel = (n.getAttribute('rel') || '').toLowerCase();
            if ((rel === 'preconnect' || rel === 'stylesheet') && /^https:\/\/fonts\.(googleapis|gstatic)\.com(\/|$)/.test(href)) {
              fontLinks.push('  ' + n.outerHTML);
            }
            n.remove();
          });
          capturedFontLinks = fontLinks.join('\n');
          if (title) title.remove();
          const header = c.querySelector(':scope > header');
          while (header && c.firstChild !== header) c.removeChild(c.firstChild);
          const help = c.querySelector(':scope > #help-drawer');
          while (help && help.nextSibling) help.nextSibling.remove();
          pristineScaffoldHtml = (header ? '\n\n  ' : '') + c.innerHTML.trimEnd() + '\n';
        } catch (_) {}
      }
      captureArtifactScaffold();
      // window.claude carries only use(); resolve namespaces through it, never read window.claude.<name>
      // Playground pages (dev/build_playground.py): a <script id="playground"> in the body, {"type", "types": [{id, name}]}.
      // Save downloads a standalone file and the header icon is a menu that goes to a blank page of another type.
      const playground = (() => {
        try { const el = document.getElementById('playground'); return el ? JSON.parse(el.textContent) : null; } catch (_) { return null; }
      })();
      // Embedded in a host artifact (<iframe src="slug/index.html">, same origin): Save goes to the host artifact, into the
      // folder the iframe's src names, and window.claude may only exist one frame up. A top-level page leaves both alone.
      let embedDir = '', hostClaude = window.claude;
      try {
        const src = window.parent !== window && window.frameElement ? (window.frameElement.getAttribute('src') || '').split(/[?#]/)[0].replace(/^\/+/, '') : '';
        embedDir = src.slice(0, src.lastIndexOf('/') + 1);
        if (!hostClaude && embedDir) hostClaude = window.parent.claude;
      } catch (_) { embedDir = ''; }
      const claudeHost = artifactShaped && hostClaude && typeof hostClaude.use === 'function' ? hostClaude : null;
      // null: a plain file; 'pending': use() has not answered yet; 'publish': Save publishes diagram.json;
      // 'view-only': the viewer cannot save (Save hidden, Export > HTML file offered)
      let artifactMode = claudeHost && !playground ? 'pending' : null;
      let artifactApi = null;
      let downloadsApi = null;
      let publishing = false;
      let publishedTitle = null;   // the name the artifact's own <title> (index.html) carries: set at load and after each Save
      let reloadExpected = false;   // a publish (or a conflict) makes the platform reload this view

      // --- STATE ---
      let chartData = { title: "", direction: "LR", lanes: [], nodes: [], edges: [] };
      let fileHandle = null;
      let helperSavedName = '';  // file name saved via the local direct-save helper
      let helperPort = null;     // cached loopback port for the local direct-save helper
      let everSaved = false;
      let storedName = '';   // the file a stored handle from an earlier visit points at (Save writes there once allowed)
      let downloadToldOnce = false;
      let hasUnsavedChanges = false;

      // Undo / redo history: JSON snapshots of chartData, taken at each committed edit
      const HISTORY_LIMIT = 100;
      let undoStack = [];
      let redoStack = [];
      let committedJson = null;   // chartData as of the last commit (the state an undo returns to)
      let savedJson = null;       // chartData as of the last load/save (decides the Unsaved badge after undo)
      let pointerHeld = false;    // no undo mid-drag: plugins hold references into chartData while dragging

      // Viewport Pan/Zoom state
      let scale = 1.0;
      let panX = 40;
      let panY = 20;
      let isPanning = false;
      let panStartX = 0;
      let panStartY = 0;


// Elements
      const viewport = document.getElementById('viewport');
      const stage = document.getElementById('stage');
      const headerEl = document.querySelector('header');
      const leftBar = headerEl && headerEl.querySelector('.toolbar-left');
      const rightBar = headerEl && headerEl.querySelector('.toolbar-right');
      const chartTitleEl = document.getElementById('chart-title');
      const saveStatus = document.getElementById('save-status');
      const btnSave = document.getElementById('btn-save');
      const btnMore = document.getElementById('btn-more');
      const moreMenu = document.getElementById('more-menu');
      const btnAutoTidy = document.getElementById('btn-auto-tidy');
      const btnZoomIn = document.getElementById('btn-zoom-in');
      const btnZoomOut = document.getElementById('btn-zoom-out');
      const btnZoomReset = document.getElementById('btn-zoom-reset');
      const zoomLevelEl = document.getElementById('zoom-level');
      const btnUndo = document.getElementById('btn-undo');
      const btnRedo = document.getElementById('btn-redo');
      const btnHelp = document.getElementById('btn-help');
      const helpDrawer = document.getElementById('help-drawer');

      // Progressive top-pill compaction:
      // 1) .is-compact: Present drops its label
      // 2) .is-tight (or <= 900px): secondary utilities fold into the More (...) menu while Save stays labeled
      // 3) .is-compact-save (or <= 560px): Save drops its label too
      function syncHeaderCompact() {
        if (!headerEl || document.body.classList.contains('presentation')) return;
        headerEl.classList.remove('is-compact', 'is-tight', 'is-compact-save');
        const overflows = () => headerEl.scrollWidth > headerEl.clientWidth + 1
          || (chartTitleEl && chartTitleEl.scrollWidth > chartTitleEl.clientWidth + 1)
          || (leftBar && rightBar && rightBar.getBoundingClientRect().left - leftBar.getBoundingClientRect().right < 12);
        if (overflows()) headerEl.classList.add('is-compact');
        if (overflows() || window.innerWidth <= 900) headerEl.classList.add('is-tight');
        if (overflows() || window.innerWidth <= 560) headerEl.classList.add('is-compact-save');
        if (btnMore && !btnMore.getClientRects().length && moreMenu && !moreMenu.hidden) {
          moreMenu.hidden = true;
          btnMore.setAttribute('aria-expanded', 'false');
        }
      }
      if (typeof ResizeObserver !== 'undefined' && headerEl) {
        new ResizeObserver(syncHeaderCompact).observe(headerEl);
      }

      // --- MOTION KERNEL (shared by shell + all 4 diagram plugins; zero external dependencies) ---
      const noAnimParam = /[?&](?:report|tidy|noanim)(?:=|&|$)/.test(window.location.search);
      if (noAnimParam) document.documentElement.dataset.noanim = '1';
      const reducedMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      const motion = (() => {
        const dur = (k, fb = 180) => {
          const v = TOKENS.motion && TOKENS.motion[k];
          const m = v && /^(\d+(?:\.\d+)?)(m?s)/.exec(v);
          return m ? parseFloat(m[1]) * (m[2] === 's' ? 1000 : 1) : fb;
        };
        const curve = (k, fb = 'cubic-bezier(0.22, 1, 0.36, 1)') => (TOKENS.motion && TOKENS.motion[k]) || fb;
        const enabled = () => !noAnimParam && !(reducedMq && reducedMq.matches)
          && document.documentElement.dataset.diagramSettled === '1'   // not while loading: the render after the web font arrives would FLIP from the fallback-font layout, and Fit would measure it mid-flight
          && !document.body.classList.contains('capture') && !document.body.classList.contains('exporting');

        let lastPlayAt = -1000, cachedScale = 1, lastStampFrame = -1;
        const speedScale = () => {
          const now = performance.now();
          if (now - lastStampFrame <= 16) return cachedScale;
          const dt = now - lastPlayAt;
          return dt < 90 ? 0.55 : dt < 180 ? 0.75 : 1;
        };
        const markPlay = () => {
          const now = performance.now();
          if (now - lastStampFrame > 16) { cachedScale = speedScale(); lastStampFrame = now; }
          lastPlayAt = now;
          return cachedScale;
        };

        const easeCache = new Map();
        const easeFn = (nameOrCurve) => {
          const s = curve(nameOrCurve, nameOrCurve);
          if (easeCache.has(s)) return easeCache.get(s);
          let fn;
          if (s.startsWith('linear(')) {
            const pts = s.slice(7, -1).split(',').map((x) => parseFloat(x));
            const n = pts.length - 1;
            fn = (t) => {
              if (t <= 0) return pts[0];
              if (t >= 1) return pts[n];
              const p = t * n, i = p | 0;
              return pts[i] + (pts[i + 1] - pts[i]) * (p - i);
            };
          } else {
            const m = /cubic-bezier\(([^)]+)\)/.exec(s);
            if (m) {
              const [x1, y1, x2, y2] = m[1].split(',').map(Number);
              const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
              const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
              fn = (t) => {
                let u = t;
                for (let i = 0; i < 5; i++) {
                  const x = ((ax * u + bx) * u + cx) * u - t;
                  const dx = (3 * ax * u + 2 * bx) * u + cx;
                  if (Math.abs(dx) < 1e-5) break;
                  u = Math.max(0, Math.min(1, u - x / dx));
                }
                return ((ay * u + by) * u + cy) * u;
              };
            } else {
              fn = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
            }
          }
          easeCache.set(s, fn);
          return fn;
        };

        let svgJob = null;
        const activeAnims = new Set();
        const elemAnims = new WeakMap();
        // Busy hook: <html data-motion-busy="1"> while any WAAPI animation, SVG tween or camera glide is in flight (tests wait on it).
        let vpBusy = false;
        const syncBusy = () => {
          const busy = activeAnims.size > 0 || !!svgJob || vpBusy;
          const ds = document.documentElement.dataset;
          if (busy) { if (ds.motionBusy !== '1') ds.motionBusy = '1'; } else if ('motionBusy' in ds) delete ds.motionBusy;
        };
        const setViewportBusy = (b) => { vpBusy = b; syncBusy(); };
        const trackAnim = (el, anim) => {
          if (!anim) return anim;
          activeAnims.add(anim);
          syncBusy();
          let list = elemAnims.get(el);
          if (!list) { list = new Set(); elemAnims.set(el, list); }
          list.add(anim);
          const drop = () => { activeAnims.delete(anim); list.delete(anim); syncBusy(); };
          anim.addEventListener('finish', drop, { once: true });
          anim.addEventListener('cancel', drop, { once: true });
          return anim;
        };
        const cancelEl = (el) => {
          const list = elemAnims.get(el);
          if (!list) return;
          for (const a of list) { try { a.cancel(); } catch (_) {} }
          list.clear();
        };

        let ghostLayer = null;
        const ensureGhostLayer = () => {
          if (ghostLayer && ghostLayer.isConnected) return ghostLayer;
          ghostLayer = document.getElementById('motion-ghost-layer');
          if (!ghostLayer) {
            ghostLayer = document.createElement('div');
            ghostLayer.id = 'motion-ghost-layer';
            ghostLayer.setAttribute('data-export-skip', '');
            ghostLayer.setAttribute('aria-hidden', 'true');
            document.body.appendChild(ghostLayer);
          }
          return ghostLayer;
        };

        const GHOST_PROPS = [
          'display', 'position', 'boxSizing', 'flexDirection', 'flexWrap', 'alignItems', 'justifyContent',
          'gap', 'flex', 'width', 'height', 'minWidth', 'maxWidth',
          'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
          'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
          'borderTopWidth', 'borderTopStyle', 'borderTopColor',
          'borderRightWidth', 'borderRightStyle', 'borderRightColor',
          'borderBottomWidth', 'borderBottomStyle', 'borderBottomColor',
          'borderLeftWidth', 'borderLeftStyle', 'borderLeftColor',
          'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
          'backgroundColor', 'backgroundImage', 'color', 'fontFamily', 'fontSize', 'fontWeight',
          'lineHeight', 'letterSpacing', 'boxShadow', 'textAlign', 'whiteSpace', 'overflow', 'opacity'
        ];
        const freezeClone = (el, skipFn) => {
          const build = (src, isRoot) => {
            if (src.nodeType === 3) return document.createTextNode(src.nodeValue);
            if (src.nodeType !== 1) return null;
            if (!isRoot && skipFn && skipFn(src)) return null;
            const cs = getComputedStyle(src);
            if (!isRoot && cs.display === 'none') return null;
            if (src.namespaceURI === 'http://www.w3.org/2000/svg') {
              const svg = src.cloneNode(true);
              svg.removeAttribute('id'); svg.removeAttribute('class');
              svg.querySelectorAll('[id],[class]').forEach((n) => { n.removeAttribute('id'); n.removeAttribute('class'); });
              return svg;
            }
            const tag = (cs.display === 'inline' || cs.display === 'inline-flex' || cs.display === 'inline-block') && !isRoot ? 'span' : 'div';
            const dst = document.createElement(tag);
            for (let j = 0; j < GHOST_PROPS.length; j++) {
              const p = GHOST_PROPS[j];
              if (cs[p]) dst.style[p] = cs[p];
            }
            if (src.tagName === 'INPUT' || src.tagName === 'TEXTAREA') dst.textContent = src.value;
            else {
              for (let c = src.firstChild; c; c = c.nextSibling) {
                const child = build(c, false);
                if (child) dst.appendChild(child);
              }
            }
            return dst;
          };
          const clone = build(el, true);
          clone.setAttribute('data-motion-ghost', '');
          clone.setAttribute('data-export-skip', '');
          clone.setAttribute('aria-hidden', 'true');
          return clone;
        };

        const ghostExit = (el, opts) => {
          if (!el || !enabled()) return null;
          const o = opts || {};
          const r = o.fromRect || el.getBoundingClientRect();
          if (!r || r.width <= 0 || r.height <= 0) return null;
          const clone = o.preCloned || freezeClone(el, o.skipChild);
          const inStage = !o.preCloned && stage.contains(el);
          const ow = o.baseW ?? (inStage && el.offsetWidth ? el.offsetWidth : r.width);
          const oh = o.baseH ?? (inStage && el.offsetHeight ? el.offsetHeight : r.height);
          const sx = ow ? r.width / ow : 1, sy = oh ? r.height / oh : 1;
          const baseScale = (Math.abs(sx - 1) > 0.01 || Math.abs(sy - 1) > 0.01) ? ` scale(${sx}, ${sy})` : '';
          clone.style.position = 'fixed';
          clone.style.left = `${r.left}px`;
          clone.style.top = `${r.top}px`;
          clone.style.width = `${ow}px`;
          clone.style.height = `${oh}px`;
          clone.style.margin = '0';
          clone.style.pointerEvents = 'none';
          clone.style.transformOrigin = o.origin || (baseScale ? 'top left' : 'center');
          clone.style.transform = baseScale.trim() || 'none';
          ensureGhostLayer().appendChild(clone);
          let toFrame;
          if (o.toRect) {
            const dx = o.toRect.left - r.left, dy = o.toRect.top - r.top;
            const tx = (ow ? o.toRect.width / ow : 1), ty = (oh ? o.toRect.height / oh : 1);
            clone.style.transformOrigin = 'top left';
            toFrame = { transform: `translate(${dx}px, ${dy}px) scale(${tx}, ${ty})`, opacity: o.opacity ?? 0.15 };
          } else {
            toFrame = { transform: (baseScale ? baseScale + ' ' : '') + (o.transform || 'scale(0.92)'), opacity: o.opacity ?? 0 };
            if (o.clipPath) toFrame.clipPath = o.clipPath;
          }
          const fromFrame = { transform: baseScale.trim() || 'none', opacity: 1 };
          if (o.clipPath) fromFrame.clipPath = 'inset(0 0 0 0)';
          const anim = clone.animate([fromFrame, toFrame], {
            duration: Math.max(40, Math.round((o.duration ?? 110) * speedScale())),
            easing: curve(o.easing || 'curve-in'),
            fill: 'forwards'
          });
          const cleanup = () => clone.remove();
          anim.addEventListener('finish', cleanup, { once: true });
          anim.addEventListener('cancel', cleanup, { once: true });
          return trackAnim(clone, anim);
        };

        const keyOf = (spec, el) => (typeof spec.key === 'function'
          ? String(spec.key(el))
          : (spec.key.startsWith('data-') ? el.getAttribute(spec.key) : el.dataset[spec.key]) || '');

        const capture = (root, specs, opts) => {
          if (!enabled() || !root) return null;
          const list = Array.isArray(specs) ? specs : [specs];
          const inStage = root === stage || stage.contains(root);
          const st = inStage ? stage.getBoundingClientRect() : null;
          const k = inStage ? (stage.offsetWidth ? st.width / stage.offsetWidth : scale) || 1 : 1;
          const snap = new Map();
          const raw = new Map();
          const els = [];
          for (let si = 0; si < list.length; si++) {
            const spec = list[si], nodes = root.querySelectorAll(spec.selector);
            for (let i = 0; i < nodes.length; i++) {
              const el = nodes[i], id = keyOf(spec, el);
              if (!id) continue;
              const vr = el.getBoundingClientRect();
              if (!vr.width && !vr.height) continue;
              const entry = {
                id, si, mode: spec.mode || 'pos', vr, el,
                x: inStage ? (vr.left - st.left) / k : vr.left,
                y: inStage ? (vr.top - st.top) / k : vr.top,
                w: vr.width / k, h: vr.height / k,
                baseW: inStage && el.offsetWidth ? el.offsetWidth : vr.width / k,
                baseH: inStage && el.offsetHeight ? el.offsetHeight : vr.height / k,
                preCloned: opts && opts.ghosts ? freezeClone(el) : null
              };
              snap.set(si + ':' + id, entry);
              raw.set(id, entry);
              els.push(el);
            }
          }
          for (let i = 0; i < els.length; i++) cancelEl(els[i]);
          snap._raw = raw; snap._inStage = inStage;
          return snap;
        };

        const play = (snap, root, specs, opts) => {
          if (!snap || !enabled() || !root) return 0;
          const o = opts || {};
          const list = Array.isArray(specs) ? specs : [specs];
          const inStage = snap._inStage;
          const st = inStage ? stage.getBoundingClientRect() : null;
          const k = inStage ? (stage.offsetWidth ? st.width / stage.offsetWidth : scale) || 1 : 1;
          const vpW = window.innerWidth, vpH = window.innerHeight;
          const items = [];
          const newByKey = new Map();
          const newRaw = new Map();
          for (let si = 0; si < list.length; si++) {
            const spec = list[si], nodes = root.querySelectorAll(spec.selector);
            for (let i = 0; i < nodes.length; i++) {
              const el = nodes[i], id = keyOf(spec, el);
              if (!id) continue;
              if (o.skipKeys && o.skipKeys.has(id)) continue;
              if (o.skipSelector && el.matches(o.skipSelector)) continue;
              const vr = el.getBoundingClientRect();
              if (!vr.width && !vr.height) continue;
              const it = {
                id, key: si + ':' + id, mode: spec.mode || 'pos', el, vr,
                x: inStage ? (vr.left - st.left) / k : vr.left,
                y: inStage ? (vr.top - st.top) / k : vr.top,
                w: vr.width / k, h: vr.height / k
              };
              items.push(it);
              newByKey.set(it.key, it);
              newRaw.set(id, it);
            }
          }
          const sf = markPlay();
          const baseDur = Math.max(40, Math.round((o.duration ?? dur('dur-layout', 230)) * sf));
          const easing = curve(o.easing || 'curve-spring-settle');
          const cull = items.length > 60;
          const ox = o.originRect ? (inStage ? (o.originRect.left - st.left) / k : o.originRect.left) : 0;
          const oy = o.originRect ? (inStage ? (o.originRect.top - st.top) / k : o.originRect.top) : 0;
          const ow = o.originRect ? o.originRect.width / k : 0;
          const oh = o.originRect ? o.originRect.height / k : 0;
          const lookup = (map, id) => !map ? null : (map instanceof Map ? map.get(id) : map[id]);

          for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (cull && (it.vr.right < 0 || it.vr.left > vpW || it.vr.bottom < 0 || it.vr.top > vpH)) continue;
            const prev = snap.get(it.key);
            if (prev) {
              const dx = prev.x - it.x, dy = prev.y - it.y;
              const dw = Math.abs(prev.w - it.w), dh = Math.abs(prev.h - it.h);
              const mode = cull ? 'pos' : it.mode;
              const moved = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
              const resized = mode !== 'pos' && (dw > 1 || dh > 1);
              if (!moved && !resized) continue;
              if (resized && mode === 'size' && it.w > 0 && it.h > 0) {
                const rw = prev.w / it.w, rh = prev.h / it.h;
                if (rw >= 0.45 && rw <= 2.2 && rh >= 0.45 && rh <= 2.2) {
                  it.el.style.transformOrigin = o.transformOrigin || 'top left';
                  trackAnim(it.el, it.el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${rw}, ${rh})` }, { transform: 'none' }], { duration: baseDur, easing }));
                  continue;
                }
              }
              if (resized && (it.w > prev.w || it.h > prev.h)) {
                const rClip = Math.max(0, it.w - prev.w), bClip = Math.max(0, it.h - prev.h);
                trackAnim(it.el, it.el.animate([
                  { transform: `translate(${dx}px, ${dy}px)`, clipPath: `inset(0 ${rClip}px ${bClip}px 0)` },
                  { transform: 'none', clipPath: 'inset(0 0 0 0)' }
                ], { duration: baseDur, easing }));
              } else {
                trackAnim(it.el, it.el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: baseDur, easing }));
              }
            } else if (o.enter !== false) {
              const fk = lookup(o.fromKey, it.id);
              const src = fk ? snap._raw.get(fk) : (o.originRect ? { x: ox, y: oy, w: ow, h: oh } : null);
              if (src && it.w > 0 && it.h > 0) {
                const dx = src.x - it.x, dy = src.y - it.y;
                const rw = Math.max(0.25, Math.min(2.5, src.w / it.w)), rh = Math.max(0.25, Math.min(2.5, src.h / it.h));
                it.el.style.transformOrigin = 'top left';
                trackAnim(it.el, it.el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${rw}, ${rh})` }, { transform: 'none' }], { duration: baseDur, easing }));
              } else {
                const sc = o.enterScale ?? 0.88;
                if (o.enterShift != null) {
                  // calm entrance (tab switch): a short slide and a fade, no clip, no overshoot
                  trackAnim(it.el, it.el.animate([
                    { opacity: 0, transform: `translateY(${o.enterShift}px) scale(${sc})` },
                    { opacity: 1, transform: 'none' }
                  ], { duration: baseDur, easing: curve(o.enterEasing || 'curve-out') }));
                  continue;
                }
                trackAnim(it.el, it.el.animate([
                  { transform: `scale(${sc})`, clipPath: 'inset(6% 6% 6% 6%)' },
                  { transform: 'none', clipPath: 'inset(0 0 0 0)' }
                ], { duration: Math.round(baseDur * 0.82), easing: curve('curve-spring-tactile') }));
              }
            }
          }
          if (o.toKey || o.ghostExit) {
            for (const [k2, prev] of snap) {
              if (newByKey.has(k2)) continue;
              const tk = lookup(o.toKey, prev.id);
              const target = tk ? newRaw.get(tk) : null;
              if (target && prev.preCloned) ghostExit(prev.el, { preCloned: prev.preCloned, fromRect: prev.vr, toRect: target.vr, baseW: prev.baseW, baseH: prev.baseH, duration: baseDur, easing });
              else if (o.ghostExit && prev.preCloned) ghostExit(prev.el, { preCloned: prev.preCloned, fromRect: prev.vr, baseW: prev.baseW, baseH: prev.baseH, duration: o.exitDuration ?? 110, transform: o.exitTransform, easing: o.exitEasing });
            }
          }
          return baseDur;
        };

        const morphRect = (fromRect, toEl, opts) => {
          if (!enabled() || !fromRect || !toEl) return null;
          const o = opts || {};
          cancelEl(toEl);
          const toRect = toEl.getBoundingClientRect();
          if (!toRect.width || !toRect.height) return null;
          const inStage = stage.contains(toEl);
          const k = inStage && stage.offsetWidth ? stage.getBoundingClientRect().width / stage.offsetWidth : 1;
          const dx = (fromRect.left - toRect.left) / k, dy = (fromRect.top - toRect.top) / k;
          const sx = fromRect.width / toRect.width, sy = fromRect.height / toRect.height;
          if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.02 && Math.abs(sy - 1) < 0.02) return null;
          toEl.style.transformOrigin = o.origin || 'top left';
          return trackAnim(toEl, toEl.animate(
            [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: 'none' }],
            { duration: Math.max(40, Math.round((o.duration ?? dur('dur-base', 180)) * speedScale())), easing: curve(o.easing || 'curve-spring-settle') }
          ));
        };

        const drawPath = (pathEl, opts) => {
          if (!enabled() || !pathEl || typeof pathEl.getTotalLength !== 'function') return null;
          const o = opts || {};
          const len = pathEl.getTotalLength();
          if (!len) return null;
          cancelEl(pathEl);
          // Preserve an existing CSS dash pattern (e.g. .connector-guide) by repeating it up to `len`
          // followed by a `len`-long gap, so the line draws on dashed instead of flashing solid.
          const cs = getComputedStyle(pathEl);
          const rawDash = (cs.strokeDasharray || '').trim();
          const nums = rawDash && rawDash !== 'none'
            ? rawDash.split(/[\s,]+/).map(v => parseFloat(v)).filter(v => Number.isFinite(v) && v > 0)
            : [];
          let dashArray = `${len} ${len}`;
          let startOffset = len;
          if (nums.length) {
            const pat = nums.length % 2 === 1 ? nums.concat(nums) : nums;
            const period = pat.reduce((a, b) => a + b, 0);
            if (period > 0 && len / period <= 2000) {
              const reps = Math.ceil(len / period);
              const seq = [];
              for (let i = 0; i < reps; i++) seq.push(...pat);
              const pad = Math.ceil(parseFloat(cs.strokeWidth) || 2);
              startOffset = reps * period;
              seq[seq.length - 1] += Math.ceil(len) + pad;
              dashArray = seq.join(' ');
            }
          }
          pathEl.style.strokeDasharray = dashArray;
          pathEl.style.strokeDashoffset = `${startOffset}`;
          const anim = pathEl.animate([{ strokeDashoffset: startOffset }, { strokeDashoffset: 0 }], {
            duration: Math.max(40, Math.round((o.duration ?? dur('dur-fast', 140)) * speedScale())),
            easing: curve(o.easing || 'curve-out')
          });
          const clear = () => { pathEl.style.strokeDasharray = ''; pathEl.style.strokeDashoffset = ''; };
          anim.addEventListener('finish', clear, { once: true });
          anim.addEventListener('cancel', clear, { once: true });
          return trackAnim(pathEl, anim);
        };

        const normPoly = (a, b) => {
          const out = a.slice();
          while (out.length < b.length) {
            let best = 0, bestLen = -1;
            for (let i = 0; i < out.length - 2; i += 2) {
              const l = Math.hypot(out[i + 2] - out[i], out[i + 3] - out[i + 1]);
              if (l > bestLen) { bestLen = l; best = i; }
            }
            out.splice(best + 2, 0, (out[best] + out[best + 2]) / 2, (out[best + 1] + out[best + 3]) / 2);
          }
          return out;
        };

        const applySvgJob = (job, p) => {
          const { n, els, kinds, offs, cnts, fromBuf, toBuf } = job;
          for (let i = 0; i < n; i++) {
            const o = offs[i], k = kinds[i], el = els[i];
            if (k === 0) {
              el.setAttribute('d',
                'M ' + (fromBuf[o] + (toBuf[o] - fromBuf[o]) * p) + ' ' + (fromBuf[o + 1] + (toBuf[o + 1] - fromBuf[o + 1]) * p) +
                ' C ' + (fromBuf[o + 2] + (toBuf[o + 2] - fromBuf[o + 2]) * p) + ' ' + (fromBuf[o + 3] + (toBuf[o + 3] - fromBuf[o + 3]) * p) +
                ', ' + (fromBuf[o + 4] + (toBuf[o + 4] - fromBuf[o + 4]) * p) + ' ' + (fromBuf[o + 5] + (toBuf[o + 5] - fromBuf[o + 5]) * p) +
                ', ' + (fromBuf[o + 6] + (toBuf[o + 6] - fromBuf[o + 6]) * p) + ' ' + (fromBuf[o + 7] + (toBuf[o + 7] - fromBuf[o + 7]) * p));
            } else if (k === 1) {
              if (el.tagName === 'path') {
                el.setAttribute('d', 'M ' + (fromBuf[o] + (toBuf[o] - fromBuf[o]) * p) + ' ' + (fromBuf[o + 1] + (toBuf[o + 1] - fromBuf[o + 1]) * p) +
                  ' L ' + (fromBuf[o + 2] + (toBuf[o + 2] - fromBuf[o + 2]) * p) + ' ' + (fromBuf[o + 3] + (toBuf[o + 3] - fromBuf[o + 3]) * p));
              } else {
                el.setAttribute('x1', fromBuf[o] + (toBuf[o] - fromBuf[o]) * p);
                el.setAttribute('y1', fromBuf[o + 1] + (toBuf[o + 1] - fromBuf[o + 1]) * p);
                el.setAttribute('x2', fromBuf[o + 2] + (toBuf[o + 2] - fromBuf[o + 2]) * p);
                el.setAttribute('y2', fromBuf[o + 3] + (toBuf[o + 3] - fromBuf[o + 3]) * p);
              }
            } else if (k === 2) {
              el.setAttribute('x', fromBuf[o] + (toBuf[o] - fromBuf[o]) * p);
              el.setAttribute('y', fromBuf[o + 1] + (toBuf[o + 1] - fromBuf[o + 1]) * p);
              el.setAttribute('width', Math.max(0, fromBuf[o + 2] + (toBuf[o + 2] - fromBuf[o + 2]) * p));
              el.setAttribute('height', Math.max(0, fromBuf[o + 3] + (toBuf[o + 3] - fromBuf[o + 3]) * p));
            } else {
              const cnt = cnts[i], isPoly = k === 4;
              let s = (isPoly ? '' : 'M ') + (fromBuf[o] + (toBuf[o] - fromBuf[o]) * p) + ' ' + (fromBuf[o + 1] + (toBuf[o + 1] - fromBuf[o + 1]) * p);
              for (let j = 2; j < cnt; j += 2) {
                s += (isPoly ? ' ' : ' L ') + (fromBuf[o + j] + (toBuf[o + j] - fromBuf[o + j]) * p) + ' ' + (fromBuf[o + j + 1] + (toBuf[o + j + 1] - fromBuf[o + j + 1]) * p);
              }
              el.setAttribute(isPoly ? 'points' : 'd', s);
            }
          }
        };

        const tweenSvg = (tracks, opts) => {
          if (svgJob) { cancelAnimationFrame(svgJob.raf); svgJob = null; syncBusy(); }
          if (!enabled() || !tracks || !tracks.length) return;
          const o = opts || {};
          const polyCap = tracks.length > 35;
          const active = [];
          let total = 0;
          for (let i = 0; i < tracks.length; i++) {
            const tr = tracks[i];
            if (!tr || !tr.el || !tr.from || !tr.to) continue;
            if (tr.type === 'polyline') {
              if (polyCap || Math.abs(tr.from.length - tr.to.length) > 24 || tr.from.length < 4 || tr.to.length < 4) {
                if (!polyCap && tr.el.tagName === 'path') drawPath(tr.el, o);
                continue;
              }
              const f = tr.from.length < tr.to.length ? normPoly(tr.from, tr.to) : tr.from;
              const t = tr.to.length < tr.from.length ? normPoly(tr.to, tr.from) : tr.to;
              active.push({ kind: tr.el.tagName === 'polyline' ? 4 : 3, el: tr.el, f, t });
              total += f.length;
            } else {
              const kind = tr.type === 'bezier' ? 0 : tr.type === 'rect' ? 2 : 1;
              const len = kind === 0 ? 8 : 4;
              if (tr.from.length < len || tr.to.length < len) continue;
              active.push({ kind, el: tr.el, f: tr.from, t: tr.to });
              total += len;
            }
          }
          const n = active.length;
          if (!n) return;
          const els = new Array(n), kinds = new Uint8Array(n), offs = new Int32Array(n), cnts = new Int32Array(n);
          const fromBuf = new Float64Array(total), toBuf = new Float64Array(total);
          let pos = 0;
          for (let i = 0; i < n; i++) {
            const tr = active[i], len = tr.f.length;
            els[i] = tr.el; kinds[i] = tr.kind; offs[i] = pos; cnts[i] = len;
            for (let j = 0; j < len; j++) { fromBuf[pos + j] = tr.f[j]; toBuf[pos + j] = tr.t[j]; }
            pos += len;
          }
          const d = Math.max(40, Math.round((o.duration ?? dur('dur-layout', 230)) * markPlay()));
          const ease = easeFn(o.easing || 'curve-spring-settle');
          const start = performance.now();
          const job = { n, els, kinds, offs, cnts, fromBuf, toBuf, raf: 0 };
          svgJob = job;
          syncBusy();
          const tick = (now) => {
            if (svgJob !== job) return;
            const u = Math.min(1, (now - start) / d);
            applySvgJob(job, u >= 1 ? 1 : ease(u));
            if (u < 1) job.raf = requestAnimationFrame(tick);
            else { svgJob = null; syncBusy(); if (o.onComplete) o.onComplete(); }
          };
          applySvgJob(job, 0);
          job.raf = requestAnimationFrame(tick);
        };

        let lastBar = null, barTimer = false;
        const hideBar = (barOrSel) => {
          const el = typeof barOrSel === 'string' ? document.querySelector(barOrSel) : barOrSel;
          if (!el) return;
          if (enabled()) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              const pre = freezeClone(el);
              const inSt = stage.contains(el);
              lastBar = {
                rect: r, at: performance.now(), pre, el, claimed: false,
                baseW: inSt && el.offsetWidth ? el.offsetWidth : r.width,
                baseH: inSt && el.offsetHeight ? el.offsetHeight : r.height
              };
              if (!barTimer) {
                barTimer = true;
                queueMicrotask(() => {
                  barTimer = false;
                  if (lastBar && !lastBar.claimed) ghostExit(lastBar.el, { preCloned: lastBar.pre, fromRect: lastBar.rect, baseW: lastBar.baseW, baseH: lastBar.baseH, duration: 100 });
                });
              }
            }
          }
          el.remove();
        };
        const showBar = (barEl, opts) => {
          if (!barEl || !enabled()) return;
          const o = opts || {};
          // A bar that closed an instant ago (another element was picked) fades out first; this one then opens in its own place.
          // It never travels from the old bar to the new one.
          const after = lastBar && !lastBar.claimed && performance.now() - lastBar.at < 50;
          // Opacity + transform only: a clip-path would cut the box-shadow off until it ends, so the shadow showed up late.
          const slide = o.clipRight || barEl.classList.contains('edge-bar');
          trackAnim(barEl, barEl.animate(
            [{ opacity: 0, transform: slide ? 'translateX(-8px)' : 'scale(0.94) translateY(4px)' }, { opacity: 1, transform: 'none' }],
            { duration: dur('dur-fast', 140), easing: curve('curve-out'), delay: after ? 70 : 0, fill: 'backwards' }
          ));
        };

        const unfoldNote = (cardEl, badgeEl, leaderEl, opts) => {
          if (!cardEl || !enabled()) return;
          const o = opts || {};
          const br = badgeEl && badgeEl.getBoundingClientRect();
          if (br && br.width > 0) {
            morphRect(br, cardEl, { duration: o.duration ?? 170, easing: o.easing || 'curve-spring-tactile' });
          } else {
            trackAnim(cardEl, cardEl.animate([{ transform: 'scale(0.88)' }, { transform: 'none' }], {
              duration: o.duration ?? 170, easing: curve(o.easing || 'curve-spring-tactile')
            }));
          }
          if (leaderEl) drawPath(leaderEl, { duration: 150, easing: 'curve-out' });
        };
        const foldNote = (cardEl, badgeEl, opts) => {
          if (!cardEl || !enabled()) return;
          const br = badgeEl && badgeEl.getBoundingClientRect();
          ghostExit(cardEl, { toRect: br && br.width > 0 ? br : null, duration: (opts && opts.duration) ?? 120, easing: 'curve-in' });
        };
        const hideHint = (el) => {
          if (!el) return;
          ghostExit(el, { duration: 110, transform: 'translateY(10px) scale(0.96)' });
          el.remove();
        };

        const anim = (el, frames, opts) => {
          if (!el || !enabled()) return null;
          cancelEl(el);
          return trackAnim(el, el.animate(frames, opts));
        };
        const hiddenWhile = new Set();
        const ghostMorph = (fromRect, toEl, duration, easing) => {
          if (!enabled() || !fromRect || !toEl) return null;
          const tr = toEl.getBoundingClientRect();
          if (!tr.width || !tr.height) return null;
          const dx = fromRect.left - tr.left, dy = fromRect.top - tr.top;
          if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(fromRect.width - tr.width) < 1) return null;
          const ghost = freezeClone(toEl);
          ghost.style.position = 'fixed';
          ghost.style.left = `${tr.left}px`;
          ghost.style.top = `${tr.top}px`;
          ghost.style.width = `${tr.width}px`;
          ghost.style.height = `${tr.height}px`;
          ghost.style.margin = '0';
          ghost.style.transformOrigin = 'top left';
          ensureGhostLayer().appendChild(ghost);
          toEl.style.opacity = '0';
          hiddenWhile.add(toEl);
          const a = ghost.animate([
            { transform: `translate(${dx}px, ${dy}px) scale(${fromRect.width / tr.width}, ${fromRect.height / tr.height})` },
            { transform: 'none' }
          ], { duration: Math.max(40, Math.round(duration * speedScale())), easing: curve(easing || 'curve-inout') });
          const done = () => { ghost.remove(); toEl.style.opacity = ''; hiddenWhile.delete(toEl); };
          a.addEventListener('finish', done, { once: true });
          a.addEventListener('cancel', done, { once: true });
          return trackAnim(ghost, a);
        };
        const cancelAll = () => {
          for (const a of [...activeAnims]) { try { a.cancel(); } catch (_) {} }
          activeAnims.clear();
          for (const el of hiddenWhile) el.style.opacity = '';
          hiddenWhile.clear();
          if (svgJob) { cancelAnimationFrame(svgJob.raf); applySvgJob(svgJob, 1); svgJob = null; }
          if (ghostLayer) ghostLayer.textContent = '';
          syncBusy();
        };
        const pulseEl = (el, transform = 'scale(1.15)', duration = 180) => {
          if (el && enabled()) trackAnim(el, el.animate([{ transform: 'none' }, { transform }, { transform: 'none' }], {
            duration, easing: curve('curve-spring-tactile')
          }));
        };
        const morphRing = (fromRect, toEl) => {
          if (!enabled() || !fromRect || !toEl) return;
          const tr = toEl.getBoundingClientRect();
          if (!tr.width || !tr.height || fromRect.right < 0 || fromRect.left > innerWidth || tr.right < 0 || tr.left > innerWidth) return;
          const ring = document.createElement('div');
          ring.setAttribute('data-motion-ghost', '');
          ring.setAttribute('data-export-skip', '');
          ring.setAttribute('aria-hidden', 'true');
          ring.style.cssText = `position:fixed;left:${tr.left - 2}px;top:${tr.top - 2}px;width:${tr.width + 4}px;height:${tr.height + 4}px;border:2px solid var(--focus-ring);border-radius:var(--radius-md);pointer-events:none;transform-origin:top left;`;
          ensureGhostLayer().appendChild(ring);
          const anim = ring.animate([
            { transform: `translate(${fromRect.left - tr.left}px, ${fromRect.top - tr.top}px) scale(${fromRect.width / tr.width}, ${fromRect.height / tr.height})` },
            { transform: 'none' }
          ], { duration: 160, easing: curve('curve-inout') });
          const drop = () => ring.remove();
          anim.addEventListener('finish', drop, { once: true });
          anim.addEventListener('cancel', drop, { once: true });
          trackAnim(ring, anim);
        };

        const flipDock = (mutateFn) => {
          const dock = document.querySelector('.toolbar-center');
          if (!dock || !enabled()) { mutateFn(); return; }
          const kids = [...dock.children];
          const prev = new Map();
          for (let i = 0; i < kids.length; i++) {
            const r = kids[i].getBoundingClientRect();
            if (r.width > 0) prev.set(kids[i], r);
          }
          mutateFn();
          const durMs = Math.round(dur('dur-base', 180) * speedScale());
          const eas = curve('curve-spring-settle');
          for (let i = 0; i < kids.length; i++) {
            const el = kids[i], oldR = prev.get(el), newR = el.getBoundingClientRect();
            if (!newR.width) continue;
            if (oldR) {
              const dx = oldR.left - newR.left;
              if (Math.abs(dx) > 0.5) trackAnim(el, el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: durMs, easing: eas }));
            } else {
              trackAnim(el, el.animate([{ transform: 'scale(0.85)', clipPath: 'inset(0 30% 0 30%)' }, { transform: 'none', clipPath: 'inset(0 0 0 0)' }], { duration: durMs, easing: eas }));
            }
          }
        };

        return {
          enabled, dur, curve, speedScale, easeFn, anim, ghostMorph, capture, play, morphRect,
          ghostExit, setViewportBusy, tweenSvg, drawPath, showBar, hideBar, unfoldNote, foldNote, hideHint, cancelAll, pulseEl, morphRing, flipDock
        };
      })();

      let vpAnim = null;
      function cancelViewportAnim() {
        if (!vpAnim) return;
        cancelAnimationFrame(vpAnim.raf);
        vpAnim = null;
        motion.setViewportBusy(false);
        viewport.classList.remove('gesturing');
      }
      const viewTarget = () => (vpAnim ? { scale: vpAnim.targetScale, panX: vpAnim.targetPanX, panY: vpAnim.targetPanY } : { scale, panX, panY });
      function animateViewport(targetPanX, targetPanY, targetScale, opts) {
        const o = opts || {};
        if (!motion.enabled() || o.duration === 0) {
          cancelViewportAnim();
          panX = targetPanX; panY = targetPanY; scale = targetScale;
          updateTransform();
          if (o.onComplete) o.onComplete();
          return;
        }
        const sx = panX, sy = panY, sk = scale;
        if (Math.abs(targetPanX - sx) < 0.5 && Math.abs(targetPanY - sy) < 0.5 && Math.abs(targetScale - sk) < 0.002) {
          cancelViewportAnim();
          panX = targetPanX; panY = targetPanY; scale = targetScale;
          updateTransform();
          if (o.onComplete) o.onComplete();
          return;
        }
        if (vpAnim) cancelAnimationFrame(vpAnim.raf);
        const d = Math.max(40, Math.round((o.duration ?? motion.dur('dur-camera', 240)) * motion.speedScale()));
        const ease = motion.easeFn(o.easing || 'curve-out');
        const start = performance.now();
        viewport.classList.add('gesturing');
        const job = { targetPanX, targetPanY, targetScale, raf: 0 };
        vpAnim = job;
        motion.setViewportBusy(true);
        showZoom();
        const tick = (now) => {
          if (vpAnim !== job) return;
          const u = Math.min(1, (now - start) / d);
          const p = u >= 1 ? 1 : ease(u);
          panX = sx + (targetPanX - sx) * p;
          panY = sy + (targetPanY - sy) * p;
          scale = sk + (targetScale - sk) * p;
          updateTransform();
          if (u < 1) { job.raf = requestAnimationFrame(tick); }
          else { vpAnim = null; motion.setViewportBusy(false); viewport.classList.remove('gesturing'); if (o.onComplete) o.onComplete(); }
        };
        job.raf = requestAnimationFrame(tick);
      }

      let dataReadme = null;   // the data block's "_readme" line (written by scripts/layout_engine.py assemble_page)
      let initialDataText = null;   // raw inline #diagram-data text at load, used to verify linked-folder file matches

      async function loadInitialData() {
        try {
          const dataEl = document.getElementById('diagram-data');
          let raw = '';
          if (dataEl) {
            // Read inline JSON synchronously before any await so --target file boots synchronously.
            raw = dataEl.textContent.trim();
            initialDataText = raw.replace(/\r\n?/g, '\n');
          } else {
            const [text] = await Promise.all([
              fetch('diagram.json').then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status} loading diagram.json`);
                return r.text();
              }),
              engineSrcPromise || Promise.resolve()
            ]);
            raw = text.trim();
          }
          if (raw) {
            const disk = JSON.parse(raw);
            // "_readme" is for readers of the file, not the model: keep it aside and write it back first on Save
            if (typeof disk._readme === 'string') dataReadme = disk._readme;
            delete disk._readme;
            chartData = plugin.fromDisk ? plugin.fromDisk(disk) : disk;
          }
        } catch (err) {
          console.error("Failed to parse diagram-data JSON:", err);
        }
        chartTitleEl.textContent = chartData.title || plugin.defaultTitle;
        document.title = chartTitleEl.textContent;
        publishedTitle = document.title;

        chartTitleEl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          chartTitleEl.contentEditable = 'true';
          chartTitleEl.focus();
          const range = document.createRange();
          range.selectNodeContents(chartTitleEl);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        });
        chartTitleEl.addEventListener('blur', () => {
          chartTitleEl.contentEditable = 'false';
          const val = chartTitleEl.textContent.trim();
          if (val && chartData.title !== val) {
            const sr = saveStatus.getBoundingClientRect();
            chartData.title = val;
            document.title = val;
            updateStatus(true);
            motion.morphRect(sr, saveStatus, { duration: 140, easing: 'curve-out' });
          }
        });
        chartTitleEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            chartTitleEl.blur();
          }
        });

        const urlParams = new URLSearchParams(window.location.search);
        // window.name is how an embedding page asks for it: <iframe name="present" srcdoc=...> has no query string to carry ?present
        if (urlParams.has('present') || urlParams.has('capture') || window.name === 'present') {
          document.body.classList.add('presentation');
          document.getElementById('btn-present').setAttribute('aria-pressed', 'true');
        }
        if (urlParams.has('capture')) document.body.classList.add('capture');
        initTheme();
        initSearch();

        const interactive = !urlParams.has('report') && !urlParams.has('capture');
        const applyInitialView = () => {
          fitView();
          if (!interactive || !plugin || plugin.id !== 'sequence' || scale >= 0.85) return;
          const { vpRect, frame, scaleX, minPan } = fitMetrics();
          if (vpRect.width < 600) return;
          scale = Math.min(1.0, Math.max(scaleX, 0.85));
          panX = (frame.w * scale <= vpRect.width ? (vpRect.width - frame.w * scale) / 2 : minPan) - frame.x * scale;
          panY = minPan - frame.y * scale;
          updateTransform();
        };

        try {
          plugin.render();
          applyInitialView();
          updateStatus(false);
          committedJson = savedJson = JSON.stringify(chartData);
          updateHistoryButtons();
        } finally {
          document.documentElement.classList.remove('is-loading');
          document.documentElement.dataset.diagramReady = '1';
        }

        requestAnimationFrame(() => {
          applyInitialView();
          // The web font (Google Fonts link in shell.html) loads asynchronously: render again once it is in, so label
          // fitting and edge-label widths are measured with the real glyphs, and only then report, tidy, or settle.
          syncHeaderCompact();
          const fontsIn = document.fonts && document.fonts.status !== 'loaded'
            ? document.fonts.ready.then(() => { plugin.render(); applyInitialView(); syncHeaderCompact(); }).catch(() => {})
            : Promise.resolve();
          fontsIn.then(() => {
            document.documentElement.dataset.diagramSettled = '1';
            if (/[?&]report(=|&|$)/.test(window.location.search)) setTimeout(publishRenderReport, 200);
            if (/[?&]tidy(=|&|$)/.test(window.location.search)) publishTidyResult();
          });
        });
      }

      // Present mode (body.presentation): read-only view, toggled in place by the Present button and Esc, or on at load by ?present
      const btnPresent = document.getElementById('btn-present');
      let presentEntry = null;
      const presentOn = () => document.body.classList.contains('presentation');
      function setPresent(on) {
        if (on === presentOn()) return;
        const canAnim = motion.enabled();
        const presentRect = canAnim ? btnPresent.getBoundingClientRect() : null;
        const hdr = canAnim ? document.querySelector('header') : null;
        const dockCenter = canAnim ? document.querySelector('.toolbar-center') : null;
        if (canAnim) motion.cancelAll();
        if (on && canAnim) {
          if (hdr) motion.ghostExit(hdr, { duration: 220, easing: 'curve-inout', transform: 'translateY(calc(-100% - 20px))', opacity: 1, skipChild: (el) => el.id === 'btn-present' });
          if (dockCenter) motion.ghostExit(dockCenter, { duration: 220, easing: 'curve-inout', transform: 'translateY(calc(100% + 24px))', opacity: 1 });
        }
        if (on) {
          plugin.cancelInteraction(); plugin.clearSelection();
          setHelpOpen(false, false);
          setSearchOpen(false); if (plugin.clearSearch) plugin.clearSearch();
          if (moreMenu && !moreMenu.hidden) { moreMenu.hidden = true; btnMore.setAttribute('aria-expanded', 'false'); }
          presentEntry = { json: JSON.stringify(chartData), committed: committedJson, undo: undoStack.slice(), redo: redoStack.slice() };
        }
        document.body.classList.toggle('presentation', on);
        btnPresent.setAttribute('aria-pressed', String(on));
        if (!on) syncHeaderCompact();
        if (!on && presentEntry) {   // folds made while presenting are view only: put the model and history back as they were
          const e = presentEntry;
          undoStack = e.undo; redoStack = e.redo;
          restoreSnapshot(e.json);
          committedJson = e.committed; presentEntry = null;
        } else if (plugin.render && chartData) plugin.render();   // a plugin draws its editing handles at render
        if (canAnim) {
          if (presentRect) motion.ghostMorph(presentRect, btnPresent, 220, 'curve-inout');
          if (!on) {
            const eas = motion.curve('curve-inout');
            if (hdr) hdr.querySelectorAll('.toolbar-left, .toolbar-right > :not(#btn-present)').forEach((el) => motion.anim(el, [{ transform: 'translateY(-64px)' }, { transform: 'none' }], { duration: 220, easing: eas }));
            if (dockCenter) motion.anim(dockCenter, [{ transform: 'translateY(calc(100% + 24px))' }, { transform: 'none' }], { duration: 220, easing: eas });
          }
          fitView(true);
        }
        if (on) showToast('Esc or the Present button to exit');
      }
      btnPresent.addEventListener('click', () => setPresent(!presentOn()));
      // No edit gets through in present mode: double-click (rename), context menu, file drop
      for (const type of ['dblclick', 'contextmenu', 'dragover', 'drop']) {
        window.addEventListener(type, (e) => { if (presentOn()) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
      }

      function updateStatus(unsaved) {
        if (unsaved) recordHistory();
        setStatusBadge(unsaved);
        if (typeof queueDeleteRefresh === 'function') queueDeleteRefresh();
      }

      function setStatusBadgeText(text, cls, title) {
        const changed = saveStatus.textContent !== text;
        const prevRect = changed && motion.enabled() ? saveStatus.getBoundingClientRect() : null;
        saveStatus.textContent = text;
        if (cls !== undefined) saveStatus.className = cls;
        if (title !== undefined) saveStatus.title = title;
        syncHeaderCompact();
        if (prevRect && prevRect.width > 0) {
          motion.morphRect(prevRect, saveStatus, { duration: 180, easing: 'curve-inout' });
          const roll = document.createElement('span');
          roll.style.display = 'inline-block';
          roll.textContent = text;
          saveStatus.textContent = '';
          saveStatus.appendChild(roll);
          const a = motion.anim(roll, [{ transform: 'translateY(4px)' }, { transform: 'none' }], { duration: 180, easing: motion.curve('curve-inout') });
          if (a) a.addEventListener('finish', () => { if (roll.parentNode === saveStatus) saveStatus.textContent = text; }, { once: true });
        }
      }

      // Green means "this is on disk". A page nobody has saved yet is just "Ready" (neutral).
      function setStatusBadge(unsaved) {
        hasUnsavedChanges = unsaved;
        if (unsaved) reloadExpected = false;
        if (artifactMode === 'view-only') {
          setStatusBadgeText("View only", "badge badge-status", unsaved ? 'Your edits are not kept. Use Export > HTML file to keep them.' : 'You cannot save this artifact.');
          return;
        }
        if (artifactMode === 'publish' && !unsaved) {
          setStatusBadgeText("Saved to artifact", "badge badge-status saved");
          return;
        }
        // Name the file Save writes to: the one chosen this visit, else the one remembered from an earlier visit
        const target = fileHandle ? fileHandle.name : (helperSavedName || storedName);
        if (unsaved) {
          setStatusBadgeText("Unsaved changes", "badge badge-status unsaved", target ? `Save writes to ${target}` : '');
        } else if (helperSavedName && !fileHandle) {
          setStatusBadgeText(`Saved to ${helperSavedName}`, "badge badge-status saved", `Saved straight to ${helperSavedName} via local helper`);
        } else if (fileHandle) {
          setStatusBadgeText(`Saved to ${target}`, "badge badge-status saved", `Save writes straight to ${target}`);
        } else if (everSaved) {
          setStatusBadgeText("Downloaded a copy", "badge badge-status saved", location.protocol === 'file:'
            ? 'The edited diagram went to your downloads folder. The file you opened was not changed.'
            : 'The edited diagram went to your downloads folder.');
        } else if (target) {
          setStatusBadgeText(`Saves to ${target}`, "badge badge-status", `Save writes to ${target}. Your browser may ask once per session to let this page edit it.`);
        } else {
          setStatusBadgeText("Ready", "badge badge-status", '');
        }
      }

      // --- UNDO / REDO ---
      function recordHistory() {
        if (committedJson === null) return;          // still loading
        const now = JSON.stringify(chartData);
        if (now === committedJson) return;           // nothing actually changed
        undoStack.push(committedJson);
        if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
        redoStack = [];
        committedJson = now;
        updateHistoryButtons();
      }

      function restoreSnapshot(json) {
        plugin.cancelInteraction();
        plugin.clearSelection();
        chartData = JSON.parse(json);
        committedJson = json;
        chartTitleEl.textContent = chartData.title || plugin.defaultTitle;
        document.title = chartTitleEl.textContent;
        plugin.render();
        setStatusBadge(json !== savedJson);
        updateHistoryButtons();
      }

      function nudgeHistoryIcon(btn, deg) {
        if (!motion.enabled()) return;
        const svg = btn && btn.querySelector('svg');
        if (svg) motion.anim(svg, [{ transform: 'none' }, { transform: `rotate(${deg}deg)` }, { transform: 'none' }], {
          duration: 140, easing: motion.curve('curve-spring-tactile')
        });
      }
      function undo() {
        if (!undoStack.length || pointerHeld) return;
        nudgeHistoryIcon(btnUndo, -12);
        redoStack.push(committedJson);
        restoreSnapshot(undoStack.pop());
      }

      function redo() {
        if (!redoStack.length || pointerHeld) return;
        nudgeHistoryIcon(btnRedo, 12);
        undoStack.push(committedJson);
        restoreSnapshot(redoStack.pop());
      }

      function updateHistoryButtons() {
        btnUndo.disabled = !undoStack.length;
        btnRedo.disabled = !redoStack.length;
      }

      btnUndo.addEventListener('click', undo);
      btnRedo.addEventListener('click', redo);
      window.addEventListener('pointerdown', () => { pointerHeld = true; }, true);
      window.addEventListener('pointerup', () => { pointerHeld = false; }, true);
      window.addEventListener('pointercancel', () => { pointerHeld = false; }, true);

      // --- AUTO-TIDY (the type's engine does the layout) ---
      // ?tidy: run the engine on load and publish the laid-out data (used by scripts/engine_runner.py)
      function publishTidyResult() {
        layoutDiagram(chartData);
        const el = document.createElement('script');
        el.id = 'tidy-result';
        el.type = 'application/json';
        el.textContent = JSON.stringify(chartData);
        document.body.appendChild(el);
      }

      // Keep the current zoom and pan so the user stays where they were (Fit/100% is one click away).
      btnAutoTidy.addEventListener('click', () => {
        if (plugin.tidy) { plugin.tidy(); return; }
        layoutDiagram(chartData);
        plugin.render();
        updateStatus(true);
      });

      // --- THEME (light / dark) ---
      // Priority (script in shell.html's <head>): ?theme=dark|light  >  saved choice (localStorage)  >  OS preference
      const btnTheme = document.getElementById('btn-theme');
      function currentTheme() {
        return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      }
      let themeTimer = 0;
      function applyTheme(theme, persist, fromClick) {
        const flip = () => {
          document.documentElement.setAttribute('data-theme', theme);
          btnTheme.setAttribute('aria-pressed', String(theme === 'dark'));
          btnTheme.title = btnTheme.ariaLabel = theme === 'dark' ? 'Light mode' : 'Dark mode';
          if (persist) { try { localStorage.setItem('flowchart-theme', theme); } catch (e) {} }
          if (plugin) plugin.render();   // type colors may depend on the theme
        };
        if (!persist || !motion.enabled()) { flip(); return; }
        // the ripple only for a real click on the button; a programmatic click expects a sync data-theme update
        if (document.startViewTransition && fromClick) {
          const anchor = btnTheme.getClientRects().length ? btnTheme : (btnMore && btnMore.getClientRects().length ? btnMore : btnTheme);
          const r = anchor.getBoundingClientRect();
          const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
          const maxR = Math.ceil(Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy)));
          const vt = document.startViewTransition(flip);
          vt.ready.then(() => {
            document.documentElement.animate(
              { clipPath: [`circle(0px at ${cx}px ${cy}px)`, `circle(${maxR}px at ${cx}px ${cy}px)`] },
              { duration: 260, easing: motion.curve('curve-inout'), pseudoElement: '::view-transition-new(root)' }
            );
          }).catch(() => {});
          return;
        }
        document.body.classList.add('theme-animating');
        clearTimeout(themeTimer);
        themeTimer = setTimeout(() => document.body.classList.remove('theme-animating'), 180);
        flip();
      }
      // The theme was chosen by the script at the top of <head> (shell.html), before the first paint: read it back
      function initTheme() { applyTheme(currentTheme(), false); }
      btnTheme.addEventListener('click', (e) => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true, e.isTrusted));

      // --- VIEWPORT PAN & ZOOM & FIT ---
      let lastAppliedScale = null;
      function showZoom() {
        if (plugin && plugin.zoomController && plugin.zoomController.getLabel) {
          zoomLevelEl.textContent = plugin.zoomController.getLabel();
          return;
        }
        zoomLevelEl.textContent = `${Math.round((vpAnim ? vpAnim.targetScale : scale) * 100)}%`;
      }   // a glide in flight shows where it lands
      function updateTransform() {
        if (plugin && plugin.customViewport) {
          stage.style.transform = '';
          stage.style.setProperty('--ui-scale', '1');
          showZoom();
          if (plugin.onViewChange) plugin.onViewChange();
          return;
        }
        stage.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
        if (scale !== lastAppliedScale) {
          lastAppliedScale = scale;
          stage.style.setProperty('--ui-scale', String(1 / scale));   // action bars undo the zoom: their size is fixed like the dock's
          showZoom();
        }
        if (plugin && plugin.onViewChange) plugin.onViewChange();   // e.g. keep frozen headers pinned
      }

      // --- HOVER TEXT: an element's data-tip, or the full text of a label cut off with "...", as the native tooltip ---
      const isCut = (el) => el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2;
      const isClamped = (el) => { const s = getComputedStyle(el); return s.textOverflow === 'ellipsis' || (s.webkitLineClamp && s.webkitLineClamp !== 'none'); };
      document.addEventListener('pointerover', (e) => {
        for (let el = e.target; el && el.nodeType === 1; el = el.parentElement) {
          if (el.title && !el.dataset.autoTitle) return;   // a title the type set itself wins
          const tip = el.dataset.tip || (isClamped(el) && isCut(el) ? el.textContent.trim() : '');
          if (tip) { el.title = tip; el.dataset.autoTitle = '1'; return; }
        }
      });

      // --- RENDER REPORT (only when opened with ?report; used by scripts/render_screenshot.py) ---
      function publishRenderReport() {
        const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
        const hit = (a, b) => a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
        const nodes = [...document.querySelectorAll(plugin.report.node)].map(el => ({ id: el.dataset.nodeId, box: box(el) }));
        const labels = [...document.querySelectorAll(plugin.report.label)]
          .map(el => ({ id: el.dataset.edgeId, text: (el.querySelector(plugin.report.labelText)?.textContent || '').trim(), box: box(el) }))
          .filter(l => l.text);
        const errors = [], warnings = [];
        for (let i = 0; i < labels.length; i++) {
          for (let j = i + 1; j < labels.length; j++) {
            if (hit(labels[i].box, labels[j].box)) errors.push(`Edge labels overlap: "${labels[i].text}" (${labels[i].id}) and "${labels[j].text}" (${labels[j].id})`);
          }
          nodes.forEach(n => {
            if (hit(labels[i].box, n.box)) errors.push(`Edge label "${labels[i].text}" (${labels[i].id}) overlaps node ${n.id}`);
          });
        }
        if (plugin.report.nodeText) {
          document.querySelectorAll(plugin.report.nodeText).forEach(el => {
            if (isCut(el)) {
              const nid = el.closest(plugin.report.node)?.dataset.nodeId || 'node';
              // A label that shows its full text on hover (see HOVER TEXT) is a layout note, not a data problem
              warnings.push(el.dataset.tip || el.title || isClamped(el)
                ? `Node label truncated ("..."): "${el.textContent.trim()}" (${nid}); the full text shows on hover`
                : `Node label truncated ("..."): "${el.textContent.trim()}" (${nid}) — shorten to fit 2 lines`);
            }
          });
        }
        document.querySelectorAll('.lane-title').forEach(el => {
          if (isCut(el)) {
            warnings.push(isClamped(el)
              ? `Lane title truncated ("..."): "${el.textContent.trim()}"; the full text shows on hover`
              : `Lane title truncated ("..."): "${el.textContent.trim()}" — shorten lane name`);
          }
        });
        const effPx = (sel) => {
          // data-base-px: the designed size of a label a plugin shrank to fit its shape (judged at that size)
          const sizes = [...document.querySelectorAll(sel)].map(el => parseFloat(el.dataset.basePx || getComputedStyle(el).fontSize) * scale);
          return sizes.length ? Math.round(Math.min(...sizes) * 10) / 10 : null;
        };
        const minNodeFontPx = effPx(plugin.report.nodeText);
        const minEdgeFontPx = effPx(plugin.report.labelText);
        const MIN_PX = parseFloat(new URLSearchParams(window.location.search).get('minpx')) || 11;
        const legibility = [];
        if (minNodeFontPx !== null && minNodeFontPx < MIN_PX) legibility.push(`Node text renders at ${minNodeFontPx}px at Fit zoom (${Math.round(scale * 100)}%), below the ${MIN_PX}px minimum.`);
        if (minEdgeFontPx !== null && minEdgeFontPx < MIN_PX) legibility.push(`Edge labels render at ${minEdgeFontPx}px at Fit zoom, below the ${MIN_PX}px minimum.`);
        const report = {
          viewport: { w: window.innerWidth, h: window.innerHeight },
          fitScale: Math.round(scale * 100) / 100,
          nodeCount: nodes.length, labelCount: labels.length,
          minNodeFontPx, minEdgeFontPx, minTextPx: MIN_PX, errors, legibility, warnings,
          natural: (() => { const f = contentFrame(); return { w: f.w, h: f.h }; })()
        };
        const el = document.createElement('script');
        el.id = 'render-report';
        el.type = 'application/json';
        el.textContent = JSON.stringify(report);
        document.body.appendChild(el);
      }

      // What Fit and screenshots frame: contentEl, grown by whatever the plugin says reaches past its edges
      // (plugin.contentOverflow, e.g. flowchart notes in the margin). Unscaled px; x/y <= 0 is the left/top reach.
      function contentFrame() {
        const o = (plugin.contentOverflow && plugin.contentOverflow()) || {};
        const l = o.left || 0, t = o.top || 0;
        return {
          x: -l, y: -t,
          w: (plugin.contentEl.offsetWidth || 1400) + l + (o.right || 0),
          h: (plugin.contentEl.offsetHeight || 800) + t + (o.bottom || 0)
        };
      }

      function fitMetrics() {
        const vpRect = viewport.getBoundingClientRect();
        const frame = contentFrame();
        const capture = document.body.classList.contains('capture');
        const pad = capture ? 0 : (plugin.fitPad && plugin.fitPad(vpRect.width)) || 80;
        // The floating dock covers the bottom of the viewport: fit the diagram into the band above it
        // (this matters for tall diagrams, e.g. a top-to-bottom flowchart, whose fit is limited by height)
        const dock = document.querySelector('.dock-area');
        const dockRect = dock && getComputedStyle(dock).display !== 'none' ? dock.getBoundingClientRect() : null;
        const dockBand = dockRect && dockRect.height ? Math.max(0, vpRect.bottom - dockRect.top) : 0;
        // Chrome floating over the top of the viewport (a type's [data-overlay-top], e.g. the flowchart's tab box): fit below it
        let topBand = 0;
        if (!capture) document.querySelectorAll('[data-overlay-top]').forEach((el) => {
          if (el.hidden || getComputedStyle(el).display === 'none') return;
          const r = el.getBoundingClientRect();
          if (r.height) topBand = Math.max(topBand, r.bottom - vpRect.top);
        });
        const scaleX = (vpRect.width - pad) / frame.w;
        const scaleY = (vpRect.height - dockBand - topBand - pad) / frame.h;
        return { vpRect, frame, capture, dockBand, topBand, scaleX, scaleY, minPan: capture ? 0 : 20 };
      }

      function fitView(animate) {
        if (plugin && plugin.zoomController && plugin.zoomController.reset) {
          plugin.zoomController.reset(animate);
          showZoom();
          return;
        }
        const { vpRect, frame, capture, dockBand, topBand, scaleX, scaleY, minPan } = fitMetrics();

        // Capture mode: scale to the exact width requested (?capture&w=1600) and pin to the top-left,
        // so the screenshot is the diagram only and does not depend on browser viewport quirks.
        if (capture) {
          const reqW = parseFloat(new URLSearchParams(window.location.search).get('w'));
          if (reqW > 0) {
            cancelViewportAnim();
            scale = Math.min(1, reqW / frame.w);
            panX = -frame.x * scale;
            panY = -frame.y * scale;
            updateTransform();
            return;
          }
        }

        const nextScale = Math.min(Math.max(Math.min(scaleX, scaleY), 0.25), 1.0);
        const nextPanX = Math.max(minPan, (vpRect.width - frame.w * nextScale) / 2) - frame.x * nextScale;
        const nextPanY = topBand + Math.max(minPan, (vpRect.height - dockBand - topBand - frame.h * nextScale) / 2) - frame.y * nextScale;

        if (animate && motion.enabled()) {
          animateViewport(nextPanX, nextPanY, nextScale, { duration: motion.dur('dur-camera', 240), easing: 'curve-out' });
        } else {
          cancelViewportAnim();
          scale = nextScale; panX = nextPanX; panY = nextPanY;
          updateTransform();
        }
      }

      // Middle button only pans, wherever it lands: no node drag, selection or edit sees it
      // Holding Space does the same with the primary button, and makes nodes, edges and lanes unclickable
      let spaceHeld = false;
      const typingInField = () => {
        const a = document.activeElement;
        return !!a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
      };
      const setSpaceHeld = (on) => {
        spaceHeld = on;
        document.body.classList.toggle('space-pan', on);
      };
      window.addEventListener('keydown', (e) => {
        if (e.code !== 'Space' || typingInField()) return;
        e.preventDefault();
        if (!e.repeat) setSpaceHeld(true);
      }, true);
      window.addEventListener('keyup', (e) => {
        if (e.code !== 'Space') return;
        if (spaceHeld) e.preventDefault();
        setSpaceHeld(false);
      }, true);
      window.addEventListener('blur', () => setSpaceHeld(false));
      // Swallow the click that ends a Space-drag so nothing underneath activates
      viewport.addEventListener('click', (e) => {
        if (spaceHeld) { e.preventDefault(); e.stopImmediatePropagation(); }
      }, true);

      viewport.addEventListener('pointerdown', (e) => {
        if (plugin && plugin.customViewport) return;
        if (!(e.button === 1 || (e.button === 0 && spaceHeld))) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        cancelViewportAnim();
        isPanning = true;
        panStartX = e.clientX - panX;
        panStartY = e.clientY - panY;
        viewport.classList.add('panning', 'gesturing');
      }, true);
      viewport.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }, true);
      viewport.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); } }, true);

      viewport.addEventListener('pointerdown', (e) => {
        if (plugin && plugin.customViewport) return;
        if (e.target === viewport || e.target.id === 'stage' || plugin.isBackground(e.target)) {
          if (plugin.cancelInteraction()) return;
          if (startMarquee(e)) return;   // Shift + drag draws a selection box instead of panning
          cancelViewportAnim();
          isPanning = true;
          panStartX = e.clientX - panX;
          panStartY = e.clientY - panY;
          viewport.classList.add('panning', 'gesturing');
          plugin.clearSelection();
        }
      });

      // --- TOUCH: one finger pans, two fingers pinch-zoom ---
      // The viewport sets touch-action: none, so the browser never takes a gesture over (no page zoom, no
      // pointercancel halfway through a pan). The shell owns every touch except one that lands on an item that is
      // already selected, which goes to the plugin so it can be dragged. A finger that lands on any other item pans
      // like blank canvas, so brushing past a step while panning moves nothing; a tap (no movement) is replayed to
      // the item as a pointerdown/pointerup pair, so it selects exactly as a click does. A tap on blank canvas clears
      // the selection; a pan does not. A second finger turns the gesture into a pinch anchored at the midpoint, and
      // freezes any drag the plugin started. Moves are applied once per animation frame.
      const touches = new Map();     // pointerId -> { x, y }
      let touchGesture = null;       // { kind: 'pan', sx, sy, panX, panY, moved, bg, target, init } | { kind: 'pinch', ... }
      let replayingTap = false;
      const TAP_SLOP = 8;            // px a finger may wander and still be a tap
      let transformRaf = 0;
      function scheduleTransform() {
        if (transformRaf) return;
        transformRaf = requestAnimationFrame(() => { transformRaf = 0; updateTransform(); });
      }
      function flushTransform() {
        if (!transformRaf) return;
        cancelAnimationFrame(transformRaf);
        transformRaf = 0;
        updateTransform();
      }
      const isBlankCanvas = (el) => el === viewport || el.id === 'stage' || plugin.isBackground(el);
      function startPinch() {
        const [a, b] = [...touches.values()];
        touchGesture = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, scale, panX, panY };
      }
      viewport.addEventListener('pointerdown', (e) => {
        if (plugin && plugin.customViewport) return;
        if (e.pointerType !== 'touch' || replayingTap) return;
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size >= 2) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (touches.size > 2) return;
          endMarquee();
          cancelViewportAnim();
          isPanning = false;
          plugin.cancelInteraction();
          viewport.classList.add('panning', 'gesturing');
          startPinch();
          return;
        }
        // The browser's touch adjustment snaps a touch's target to the nearest small interactive element (a step's
        // connect port, say), which is how a tap near a step starts an arrow. Use what is really under the finger.
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const target = hit && viewport.contains(hit) ? hit : e.target;
        const bg = isBlankCanvas(target);
        if (!bg && target.closest && target.closest('.selected, [data-touch-drag]')) {   // the plugin drags it
          touchGesture = null;
          if (target !== e.target) { e.stopImmediatePropagation(); replayPress(target, e, false); }
          return;
        }
        e.stopImmediatePropagation();
        touchGesture = { kind: 'pan', sx: e.clientX, sy: e.clientY, panX, panY, moved: false, bg, target, init: e };
      }, true);
      // Hand a target a press it never saw (and, for a tap, the release): plugins select and drag on pointerdown
      function replayPress(target, init, withUp) {
        const opts = { bubbles: true, cancelable: true, composed: true, pointerId: init.pointerId, pointerType: 'touch',
          isPrimary: true, clientX: init.clientX, clientY: init.clientY, button: 0, buttons: 1,
          shiftKey: init.shiftKey, ctrlKey: init.ctrlKey, metaKey: init.metaKey, altKey: init.altKey };
        replayingTap = true;
        try {
          target.dispatchEvent(new PointerEvent('pointerdown', opts));
          if (withUp) target.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, opts, { buttons: 0 })));
        } finally { replayingTap = false; }
      }
      window.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const g = touchGesture;
        if (!g) return;                       // a plugin drag of a selected item
        e.stopPropagation();                  // nothing else follows a finger the shell owns (or a frozen drag)
        if (g.kind === 'pinch') {
          if (touches.size < 2) return;
          const [a, b] = [...touches.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const ns = Math.min(Math.max(g.scale * d / g.dist, 0.2), 2.5);
          const vp = viewport.getBoundingClientRect();
          // The canvas point that was under the starting midpoint stays under the current midpoint
          panX = (mx - vp.left) - (g.mx - vp.left - g.panX) * (ns / g.scale);
          panY = (my - vp.top) - (g.my - vp.top - g.panY) * (ns / g.scale);
          scale = ns;
          scheduleTransform();
          return;
        }
        const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
        if (!g.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
        if (!g.moved) { cancelViewportAnim(); g.moved = true; viewport.classList.add('panning', 'gesturing'); }
        panX = g.panX + dx;
        panY = g.panY + dy;
        scheduleTransform();
      }, true);
      function endTouch(e) {
        if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
        touches.delete(e.pointerId);
        const g = touchGesture;
        if (!g) return;
        if (g.kind === 'pinch') {
          if (touches.size === 1) {           // one finger left: carry on panning with it
            const [rest] = [...touches.values()];
            touchGesture = { kind: 'pan', sx: rest.x, sy: rest.y, panX, panY, moved: true };
          } else if (touches.size === 0) {
            touchGesture = null;
            viewport.classList.remove('panning', 'gesturing');
          }
          return;
        }
        touchGesture = null;
        viewport.classList.remove('panning', 'gesturing');
        if (g.moved || e.type !== 'pointerup' || touches.size) return;
        if (g.bg) {                           // a tap on blank canvas
          if (!plugin.cancelInteraction()) plugin.clearSelection();
          return;
        }
        // A tap on an item: hand it the press it never saw, after this pointerup has finished its own dispatch
        const { target, init } = g;
        setTimeout(() => { if (target.isConnected) replayPress(target, init, true); }, 0);
      }
      window.addEventListener('pointerup', endTouch, true);
      window.addEventListener('pointercancel', endTouch, true);

      // --- SELECTION BOX (opt-in: only for a plugin that defines selectInRect / selectAll) ---
      // Shift + drag on blank canvas draws a box; Ctrl/Cmd + Shift + drag makes it a toggle box. On every move the
      // plugin's selectInRect(rect, mode, start) selects what the box touches, so the selection previews live:
      // rect is in client coordinates, mode is 'replace' or 'toggle', start is true on a box's first call. The
      // selection is not cleared when a box starts. Ctrl/Cmd + A calls selectAll(). Without these members
      // Shift + drag pans and Ctrl/Cmd + A is the browser's own. Both are off in present mode.
      let marquee = null;   // { el, x, y, mode }
      const isTyping = () => { const a = document.activeElement; return !!a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); };
      function startMarquee(e) {
        if (!e.shiftKey || !plugin.selectInRect || document.body.classList.contains('presentation')) return false;
        e.preventDefault();
        if (isTyping()) document.activeElement.blur();   // commit a label being edited, as any click on the canvas does
        const el = document.createElement('div');
        el.className = 'marquee';
        document.body.appendChild(el);
        marquee = { el, x: e.clientX, y: e.clientY, mode: (e.ctrlKey || e.metaKey) ? 'toggle' : 'replace' };
        moveMarquee(e, true);
        return true;
      }
      function moveMarquee(e, start = false) {
        const left = Math.min(marquee.x, e.clientX), top = Math.min(marquee.y, e.clientY);
        const width = Math.abs(e.clientX - marquee.x), height = Math.abs(e.clientY - marquee.y);
        Object.assign(marquee.el.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
        plugin.selectInRect({ left, top, right: left + width, bottom: top + height, width, height }, marquee.mode, start);
      }
      function endMarquee() {
        if (!marquee) return;
        if (marquee.el.offsetWidth > 4 || marquee.el.offsetHeight > 4) {
          motion.ghostExit(marquee.el, { duration: 90, transform: 'scale(0.92)' });
        }
        marquee.el.remove();
        marquee = null;
      }
      window.addEventListener('pointermove', (e) => { if (marquee) moveMarquee(e); });
      window.addEventListener('pointerup', endMarquee);
      window.addEventListener('pointercancel', endMarquee);
      window.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'a' || !plugin.selectAll) return;
        if (isTyping() || document.body.classList.contains('presentation')) return;
        e.preventDefault();
        plugin.selectAll();
      });

      window.addEventListener('pointermove', (e) => {
        if (!isPanning) return;
        panX = e.clientX - panStartX;
        panY = e.clientY - panStartY;
        scheduleTransform();
      });

      function endMousePan() {
        if (!isPanning) return;
        flushTransform();
        isPanning = false;
        viewport.classList.remove('panning');
        if (!touchGesture && !vpAnim) viewport.classList.remove('gesturing');
      }
      window.addEventListener('pointerup', endMousePan);
      window.addEventListener('pointercancel', endMousePan);

      const WHEEL_SCROLL = 0.4;   // canvas px per px a mouse wheel notch reports (~40px per notch)
      let wheelGestureTimer = 0;
      function bumpWheelGesture() {
        viewport.classList.add('gesturing');
        clearTimeout(wheelGestureTimer);
        wheelGestureTimer = setTimeout(() => {
          wheelGestureTimer = 0;
          if (!isPanning && !touchGesture && !vpAnim) viewport.classList.remove('gesturing');
        }, 140);
      }
      viewport.addEventListener('wheel', (e) => {
        if (plugin && plugin.customViewport) {
          if ((e.ctrlKey || e.metaKey) && plugin.zoomController) {
            e.preventDefault();
            if (e.deltaY < 0 && plugin.zoomController.zoomIn) plugin.zoomController.zoomIn(e);
            else if (e.deltaY > 0 && plugin.zoomController.zoomOut) plugin.zoomController.zoomOut(e);
            showZoom();
          }
          return;
        }
        e.preventDefault();
        cancelViewportAnim();
        const unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 400 : 1);
        const dX = e.deltaX * unit, dY = e.deltaY * unit;
        const isZoom = e.ctrlKey || e.metaKey;   // Ctrl/Cmd + wheel, and a trackpad pinch (reported as ctrl+wheel)
        if (!isZoom) {
          // The wheel scrolls the canvas: vertically, or sideways with Shift (or a trackpad's horizontal swipe)
          // A mouse wheel notch reports ~100px (or a line/page unit), which moves the canvas too far: scroll it 40%
          // of that. A trackpad sends many small deltas, which stay 1:1 so the canvas follows the fingers.
          const notch = e.deltaMode !== 0 || Math.max(Math.abs(dX), Math.abs(dY)) >= 50;
          const k = notch ? WHEEL_SCROLL : 1;
          const sideways = e.shiftKey && !dX;
          panX -= (sideways ? dY : dX) * k;
          panY -= (sideways ? 0 : dY) * k;
          bumpWheelGesture();
          updateTransform();
          return;
        }
        // Zoom anchored at the cursor. A mouse wheel notch reports ~100px, a pinch a few px per event: the step is
        // proportional to the gesture but capped at 15% per event, so one notch is one gentle step, not a jump to
        // the zoom limit
        const step = Math.sign(dY) * Math.min(Math.abs(dY) * 0.01, 0.14);
        const newScale = Math.min(Math.max(scale * Math.exp(-step), 0.2), 2.5);
        const vp = viewport.getBoundingClientRect();
        const cx = e.clientX - vp.left, cy = e.clientY - vp.top;
        panX = cx - (cx - panX) * (newScale / scale);
        panY = cy - (cy - panY) * (newScale / scale);
        scale = newScale;
        bumpWheelGesture();
        updateTransform();
      }, { passive: false });

      btnZoomIn.addEventListener('click', () => {
        if (plugin && plugin.zoomController && plugin.zoomController.zoomIn) {
          plugin.zoomController.zoomIn();
          showZoom();
          return;
        }
        const base = vpAnim ? vpAnim.targetScale : scale;
        const tx = vpAnim ? vpAnim.targetPanX : panX, ty = vpAnim ? vpAnim.targetPanY : panY;
        animateViewport(tx, ty, Math.min(base * 1.15, 2.5), { duration: 200, easing: 'curve-out' });
      });
      btnZoomOut.addEventListener('click', () => {
        if (plugin && plugin.zoomController && plugin.zoomController.zoomOut) {
          plugin.zoomController.zoomOut();
          showZoom();
          return;
        }
        const base = vpAnim ? vpAnim.targetScale : scale;
        const tx = vpAnim ? vpAnim.targetPanX : panX, ty = vpAnim ? vpAnim.targetPanY : panY;
        animateViewport(tx, ty, Math.max(base * 0.85, 0.2), { duration: 200, easing: 'curve-out' });
      });
      btnZoomReset.addEventListener('click', () => fitView(true));

      function setHelpOpen(open, restoreFocus) {
        const wasOpen = helpDrawer.classList.contains('open');
        if (open === wasOpen) return;
        if (!open) {
          motion.ghostExit(helpDrawer, {
            duration: 110,
            transform: 'scale(0.92, 0.86) translateY(-4px)',
            clipPath: 'inset(0 0 25% 0 round 8px)',
            origin: 'top right'
          });
        }
        helpDrawer.classList.toggle('open', open);
        btnHelp.setAttribute('aria-expanded', String(open));
        if (open) {
          if (motion.enabled()) {
            helpDrawer.style.transformOrigin = 'top right';
            motion.anim(helpDrawer, [
              { transform: 'scale(0.92, 0.86) translateY(-4px)', clipPath: 'inset(0 0 25% 0 round 8px)' },
              { transform: 'none', clipPath: 'inset(0 0 0 0 round 8px)' }
            ], { duration: motion.dur('dur-base', 160), easing: motion.curve('curve-spring-tactile') });
          }
          document.getElementById('help-close').focus();
        } else if (restoreFocus) {
          (btnHelp.getClientRects().length ? btnHelp : (btnMore || btnHelp)).focus();
        }
      }
      btnHelp.addEventListener('click', () => { setHelpOpen(!helpDrawer.classList.contains('open'), false); });
      document.getElementById('help-close').addEventListener('click', () => setHelpOpen(false, true));
      document.addEventListener('pointerdown', (e) => {
        if (helpDrawer.classList.contains('open') && !helpDrawer.contains(e.target) && !btnHelp.contains(e.target)) {
          setHelpOpen(false, false);
        }
      }, true);

      // --- SEARCH (spec: dev/plans/search.md) ---
      // Contract: a plugin may define searchItems() -> [{ id, text, el }] in reading order; id is stable across
      // renders, text is what the reader sees, el is what gets dimmed, ringed and centred. Without it, no search button.
      // The shell calls it on every query and after every render, so it reads the live DOM and stays cheap.
      // Search is view-only: never in chartData, undo, Save, exports or Mermaid.
      window.__searchItems = () => (plugin && plugin.searchItems ? plugin.searchItems() : []);

      const btnSearch = document.getElementById('btn-search');
      const searchBar = document.getElementById('search-bar');
      const searchInput = document.getElementById('search-input');
      const searchCount = document.getElementById('search-count');
      const searchPrev = document.getElementById('search-prev');
      const searchNext = document.getElementById('search-next');
      const SEARCH_MIN_SCALE = 0.6;   // below this zoom a centred match is too small to read, so zoom in on it
      let searchMatches = [];         // [{ id, text, el }] matching the query, one per element, in plugin order
      let searchIndex = 0;

      const searchFold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const searchOpen = () => !searchBar.hidden;

      // Marks the stage for the current query and keeps the current match when its id still matches.
      function applySearch() {
        const prevCur = stage.querySelector('.search-current');
        const prevRect = prevCur && motion.enabled() ? prevCur.getBoundingClientRect() : null;
        stage.querySelectorAll('.search-dim, .search-current').forEach(el => el.classList.remove('search-dim', 'search-current'));
        const q = searchFold(searchInput.value.trim());
        const keep = searchMatches[searchIndex] && searchMatches[searchIndex].id;
        searchMatches = [];
        if (q && searchOpen()) {
          const items = window.__searchItems();
          const seen = new Set();
          items.forEach(it => { if (searchFold(it.text).includes(q) && !seen.has(it.el)) { seen.add(it.el); searchMatches.push(it); } });
          items.forEach(it => { if (!seen.has(it.el)) it.el.classList.add('search-dim'); });
          const kept = searchMatches.findIndex(m => m.id === keep);
          searchIndex = kept >= 0 ? kept : Math.min(searchIndex, Math.max(searchMatches.length - 1, 0));
          if (searchMatches[searchIndex]) {
            const nextEl = searchMatches[searchIndex].el;
            nextEl.classList.add('search-current');
            if (prevRect && nextEl !== prevCur) motion.morphRing(prevRect, nextEl);
          }
        } else searchIndex = 0;
        searchCount.textContent = !q ? '' : searchMatches.length ? `${searchIndex + 1} / ${searchMatches.length}` : 'No matches';
        searchPrev.disabled = searchNext.disabled = !searchMatches.length;
      }

      // Centres the current match using the same scale/pan transform as fitView, zooming in only when it would be too small.
      function centreSearchMatch() {
        const m = searchMatches[searchIndex];
        if (!m) return;
        // Positions are read relative to the stage as it is drawn now (a glide may still be running), not from scale/pan.
        const vp = viewport.getBoundingClientRect(), r = m.el.getBoundingClientRect(), st = stage.getBoundingClientRect();
        const k = (stage.offsetWidth ? st.width / stage.offsetWidth : 0) || scale;
        let s = scale;
        if (s < SEARCH_MIN_SCALE && r.width && r.height) {
          const fit = Math.min((vp.width - 160) / (r.width / k), (vp.height - 160) / (r.height / k), 1);
          s = Math.max(s, Math.min(Math.max(fit, 0.25), 1));
        }
        const cx = (r.left + r.width / 2 - st.left) / k, cy = (r.top + r.height / 2 - st.top) / k;
        animateViewport(vp.width / 2 - cx * s, vp.height / 2 - cy * s, s, { duration: 220, easing: 'curve-out' });
      }

      function stepSearch(dir) {
        if (!searchMatches.length) return;
        searchIndex = (searchIndex + dir + searchMatches.length) % searchMatches.length;
        applySearch();
        centreSearchMatch();
      }

      function setSearchOpen(on) {
        const wasOpen = !searchBar.hidden;
        if (on === wasOpen) {
          if (!on) { searchInput.value = ''; applySearch(); }
          return;
        }
        if (!on) {
          motion.ghostExit(searchBar, { duration: 110, transform: 'scale(0.94, 0.86) translateY(-4px)', clipPath: 'inset(0 0 100% 0 round 8px)', origin: 'top right' });
        }
        searchBar.hidden = !on;
        btnSearch.setAttribute('aria-expanded', String(on));
        if (on) {
          if (motion.enabled()) {
            searchBar.style.transformOrigin = 'top right';
            motion.anim(searchBar, [
              { transform: 'scale(0.94, 0.86) translateY(-4px)', clipPath: 'inset(0 0 100% 0 round 8px)' },   // drops from the pill's search button
              { transform: 'none', clipPath: 'inset(0 0 0 0 round 8px)' }
            ], { duration: 160, easing: motion.curve('curve-out') });
          }
          searchInput.focus(); searchInput.select();
        } else {
          searchInput.value = '';
          searchInput.blur();
        }
        applySearch();
      }

      // Plugins that re-render on their own (edit, undo, theme) replace stage children; the query is applied again then.
      new MutationObserver(() => { if (searchOpen() && searchInput.value) applySearch(); }).observe(stage, { childList: true, subtree: true });

      function initSearch() {
        btnSearch.hidden = !(plugin && plugin.searchItems);
        if (btnSearch.hidden) return;
        btnSearch.addEventListener('click', () => setSearchOpen(!searchOpen()));
        searchPrev.addEventListener('click', () => stepSearch(-1));
        searchNext.addEventListener('click', () => stepSearch(1));
        searchInput.addEventListener('input', () => { searchIndex = 0; applySearch(); centreSearchMatch(); });
        searchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); stepSearch(e.shiftKey ? -1 : 1); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSearchOpen(false); }
        });
        // A click elsewhere closes an empty search bar (one with text stays, its dimming is the result)
        document.addEventListener('pointerdown', (e) => {
          if (searchOpen() && !searchInput.value && !e.target.closest('#search-dock, #btn-search')) setSearchOpen(false);
        }, true);
        window.addEventListener('keydown', (e) => {
          const mod = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f';
          const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey;
          if ((mod || slash) && !typingInField() && !presentOn()) { e.preventDefault(); setSearchOpen(true); }
          else if (e.key === 'Escape' && searchOpen() && !helpDrawer.classList.contains('open')) setSearchOpen(false);
        });
      }

      // --- EXPORT (SVG / PNG) ---
      // The stage is HTML plus SVG, so the export inlines every computed style into a clone and wraps it in a
      // foreignObject. The result is a self-contained SVG, and the PNG is that SVG rasterised.
      const btnExport = document.getElementById('btn-export');
      const exportMenu = document.getElementById('export-menu');
      const TRANSIENT_CLASSES = ['selected', 'hover', 'linked', 'hl-in', 'hl-out', 'multi-selected', 'dragging', 'lane-hover', 'search-dim', 'search-current', 'motion-entering', 'motion-active'];
      const SKIP_SELECTOR = '#drag-edge, .snap-guide, #lane-drop-line, #seq-drop-line, [data-export-skip]';
      const EXPORT_SVG_NS = 'http://www.w3.org/2000/svg';
      let defaultStyleCache = null;

      function defaultStyleFor(el) {
        if (!defaultStyleCache) {
          const frame = document.createElement('iframe');
          frame.style.cssText = 'position:fixed;left:-9999px;width:10px;height:10px;visibility:hidden';
          document.body.appendChild(frame);
          defaultStyleCache = { frame, doc: frame.contentDocument, map: {} };
          defaultStyleCache.doc.body.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
        }
        const c = defaultStyleCache, key = el.namespaceURI + '|' + el.localName;
        if (!c.map[key]) {
          const probe = c.doc.createElementNS(el.namespaceURI, el.localName);
          (el.namespaceURI === EXPORT_SVG_NS ? c.doc.body.firstChild : c.doc.body).appendChild(probe);
          const cs = c.frame.contentWindow.getComputedStyle(probe), o = {};
          for (let i = 0; i < cs.length; i++) o[cs[i]] = cs.getPropertyValue(cs[i]);
          c.map[key] = o;
        }
        return c.map[key];
      }

      function inlineStyles(src, dst) {
        const cs = getComputedStyle(src), def = defaultStyleFor(src);
        let css = '';
        for (let i = 0; i < cs.length; i++) {
          const prop = cs[i], v = cs.getPropertyValue(prop);
          if (def[prop] !== v) css += prop + ':' + v + ';';
        }
        css = css.replace(/url\("?#arrowhead-(selected|in|out)"?\)/g, 'url("#arrowhead")');
        dst.setAttribute('style', css);
        dst.removeAttribute('class');
        const sk = Array.from(src.children), dk = Array.from(dst.children);
        for (let i = 0; i < sk.length; i++) {
          if (sk[i].matches(SKIP_SELECTOR) || (sk[i].namespaceURI !== EXPORT_SVG_NS && getComputedStyle(sk[i]).display === 'none')) { dk[i].remove(); continue; }
          inlineStyles(sk[i], dk[i]);
        }
      }

      function buildExportSvg() {
        const root = stage.firstElementChild;
        if (!root) throw new Error('Nothing to export');
        motion.cancelAll();
        // Freeze transitions and drop selection/hover state while computed styles are read
        const frozen = document.createElement('style');
        frozen.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
        document.head.appendChild(frozen);
        document.body.classList.add('exporting');   // view-dependent styles (frozen headers) reset for the export
        const touched = [];
        TRANSIENT_CLASSES.forEach(cls => stage.querySelectorAll('.' + cls).forEach(el => { el.classList.remove(cls); touched.push([el, cls]); }));
        try {
          const rr = root.getBoundingClientRect(), pad = 24;
          let minX = 0, minY = 0, maxX = rr.width / scale, maxY = rr.height / scale;
          root.querySelectorAll('*').forEach(el => {
            if (el.matches(SKIP_SELECTOR) || el.closest('defs')) return;
            const r = el.getBoundingClientRect();
            if (!r.width && !r.height) return;
            minX = Math.min(minX, (r.left - rr.left) / scale); minY = Math.min(minY, (r.top - rr.top) / scale);
            maxX = Math.max(maxX, (r.right - rr.left) / scale); maxY = Math.max(maxY, (r.bottom - rr.top) / scale);
          });
          const w = Math.ceil(maxX - minX + pad * 2), h = Math.ceil(maxY - minY + pad * 2);
          const clone = root.cloneNode(true);
          inlineStyles(root, clone);
          clone.style.transform = 'none';
          clone.style.position = 'absolute';
          clone.style.left = (pad - minX) + 'px';
          clone.style.top = (pad - minY) + 'px';
          const wrap = document.createElement('div');
          wrap.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
          wrap.setAttribute('style', 'position:relative;width:' + w + 'px;height:' + h + 'px;overflow:hidden;background:' + getComputedStyle(viewport).backgroundColor);
          wrap.appendChild(clone);
          const xml = new XMLSerializer().serializeToString(wrap);
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
            '<foreignObject x="0" y="0" width="' + w + '" height="' + h + '">' + xml + '</foreignObject></svg>';
          return { svg, w, h };
        } finally {
          touched.forEach(([el, cls]) => el.classList.add(cls));
          frozen.remove();
          document.body.classList.remove('exporting');
        }
      }

      function exportFileName(ext, part) {
        const clean = (t) => String(t).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
        return (clean(chartData.title || plugin.id) || 'diagram') + (part && clean(part) ? '-' + clean(part) : '') + '.' + ext;
      }

      // Inside an artifact the page cannot start a download itself; the viewer confirms one through the downloads
      // capability. Anywhere else (or when it was not granted) this is the usual <a download>.
      async function deliverFile(filename, blob) {
        if (downloadsApi) {
          try { await downloadsApi.save({ filename, data: blob }); } catch (err) {
            showToast('Download did not complete: ' + (err && err.message || err));
          }
          return;
        }
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }

      function downloadBlob(blob, ext) { return deliverFile(exportFileName(ext), blob); }

      // A short message that slides in and retracts; used for save and download problems inside an artifact
      function showToast(message) {
        const t = document.createElement('div');
        t.className = 'toast';
        t.setAttribute('role', 'status');
        t.textContent = message;
        document.body.appendChild(t);
        setTimeout(() => {
          if (!t.isConnected) return;
          motion.ghostExit(t, { duration: 120, transform: 'translateY(12px) scale(0.95)' });
          t.remove();
        }, 6000);
      }

      function svgDocument(svg) { return '<?xml version="1.0" encoding="UTF-8"?>\n' + svg; }

      // Rasterise the export SVG at up to 1.5x. The SVG is built synchronously (styles are read now);
      // only the image decode and canvas encode are async. Rejects if the image cannot be produced.
      function exportPngBlob() {
        const { svg, w, h } = buildExportSvg();
        const k = Math.min(1.5, 16000 / Math.max(w, h), Math.sqrt(100e6 / (w * h)));
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
            const ctx = canvas.getContext('2d');
            ctx.scale(k, k);
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('image too large')), 'image/png');
          };
          img.onerror = () => reject(new Error('the diagram could not be drawn as an image'));
          // A data: URL keeps the canvas untainted; a blob: URL of a foreignObject SVG taints it in Chromium
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgDocument(svg));
        });
      }

      function exportDiagram(format) {
        try {
          if (format === 'html') { downloadHtmlFile(); return; }
          // One SVG per tab, for a type that has tabs (the flowchart's subprocess flows)
          if (format === 'svg-all') {
            plugin.eachTab(name => deliverFile(exportFileName('svg', name), new Blob([svgDocument(buildExportSvg().svg)], { type: 'image/svg+xml;charset=utf-8' })));
            return;
          }
          if (format === 'svg') {
            downloadBlob(new Blob([svgDocument(buildExportSvg().svg)], { type: 'image/svg+xml;charset=utf-8' }), 'svg');
            return;
          }
          exportPngBlob().then(b => downloadBlob(b, 'png'), err => alert('PNG export failed: ' + err.message));
        } catch (err) {
          alert('Export failed: ' + err.message);
        }
      }

      // --- COPY TO CLIPBOARD ---
      const canCopyPng = !!(navigator.clipboard && navigator.clipboard.write) && typeof ClipboardItem !== 'undefined';
      let copyFlashTimer = null;

      function flashCopied(what) { flashStatus('Copied as ' + what); }
      function flashStatus(text) {
        setStatusBadgeText(text, 'badge badge-status saved');
        clearTimeout(copyFlashTimer);
        copyFlashTimer = setTimeout(() => setStatusBadge(hasUnsavedChanges), 1500);
      }

      // What the Mermaid writer reads: the saved form of the diagram (what Save writes) without the `layout` map. A lane's
      // colour travels in that map, so it is put back on its lane.
      function mermaidData() {
        const d = plugin.toDisk ? plugin.toDisk(chartData) : JSON.parse(JSON.stringify(chartData));
        const layout = d.layout || {};
        delete d.layout;
        (d.lanes || []).forEach((l) => { if (layout[l.id] && layout[l.id].color) l.color = layout[l.id].color; });
        return d;
      }

      // Must be called straight from the click: the clipboard write has to start inside the user gesture,
      // so the PNG is handed to ClipboardItem as a Promise rather than awaited first (Safari, Chromium).
      function copyDiagram(format) {
        let job;
        try {
          if (!navigator.clipboard) throw new Error('the clipboard is not available in this browser');
          if (format === 'svg') {
            job = navigator.clipboard.writeText(svgDocument(buildExportSvg().svg));
          } else if (format === 'mermaid') {
            if (typeof plugin.toMermaid !== 'function') throw new Error('this diagram type has no Mermaid export');
            job = navigator.clipboard.writeText(plugin.toMermaid(mermaidData(), { palette: SWATCHES.map((w) => w.hex), stock: true }));
          } else if (format === 'png') {
            if (!canCopyPng) throw new Error('this browser cannot copy images');
            job = navigator.clipboard.write([new ClipboardItem({ 'image/png': exportPngBlob() })]);
          } else {
            throw new Error('unknown format ' + format);
          }
        } catch (err) {
          job = Promise.reject(err);
        }
        job.then(() => flashCopied(format === 'mermaid' ? 'Mermaid' : format.toUpperCase()),
                 err => alert('Copy failed: ' + (err && err.message || err) + '\nUse Export › Download instead.'));
      }
      document.querySelectorAll('[data-copy="png"]').forEach(el => { el.hidden = !canCopyPng; });
      document.querySelectorAll('[data-copy="svg"]').forEach(el => { el.hidden = !(navigator.clipboard && navigator.clipboard.writeText); });
      // Mermaid is offered only when the diagram type can read/write it (the type script registers after this one runs)
      const btnImportMermaid = document.getElementById('btn-import-mermaid');
      btnImportMermaid.addEventListener('click', (e) => { e.stopPropagation(); setExportOpen(false); openMermaidImport(); });
      function syncCopyMenu() {
        document.querySelectorAll('[data-copy="mermaid"]').forEach(el => { el.hidden = !(plugin && typeof plugin.toMermaid === 'function' && navigator.clipboard && navigator.clipboard.writeText); });
        btnImportMermaid.hidden = !(plugin && typeof plugin.fromMermaid === 'function');
        // Drop the "Copy" heading when this browser has no copy items to offer
        document.querySelectorAll('[data-copy-label]').forEach(el => { el.hidden = !document.querySelector('[data-copy]:not([hidden])'); });
      }
      syncCopyMenu();

      function animateMenuToggle(menu, open, leftOrigin) {
        const origin = leftOrigin ? 'top left' : 'top right';
        if (!open) {
          if (!menu.hidden) motion.ghostExit(menu, { duration: 110, transform: 'scale(0.92, 0.86) translateY(-4px)', clipPath: 'inset(0 0 25% 0 round 8px)', origin });
          menu.hidden = true;
          return;
        }
        const wasHidden = menu.hidden;
        menu.hidden = false;
        if (wasHidden && motion.enabled()) {
          menu.style.transformOrigin = origin;
          motion.anim(menu, [
            { transform: 'scale(0.92, 0.86) translateY(-4px)', clipPath: 'inset(0 0 25% 0 round 8px)' },
            { transform: 'none', clipPath: 'inset(0 0 0 0 round 8px)' }
          ], { duration: 120, easing: motion.curve('curve-out') });   // short and without overshoot: items settle before a click lands
        }
      }
      function setExportOpen(open) {
        animateMenuToggle(exportMenu, open, false);
        btnExport.setAttribute('aria-expanded', String(open));
      }
      function syncMoreMenu() {
        if (!moreMenu) return;
        moreMenu.replaceChildren();
        const addItem = (label, iconName, onClick, attr) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.setAttribute('role', 'menuitem');
          if (attr) b.dataset[attr[0]] = attr[1];
          if (iconName) b.appendChild(ui.iconEl(iconName, { size: 'sm' }));
          b.appendChild(document.createTextNode(label));
          b.addEventListener('click', (e) => { e.stopPropagation(); setMoreOpen(false); onClick(); });
          moreMenu.appendChild(b);
          return b;
        };
        const isDark = currentTheme() === 'dark';
        addItem(isDark ? 'Light mode' : 'Dark mode', isDark ? 'sun' : 'moon', () => btnTheme.click(), ['more', 'theme']);
        addItem('Shortcuts', 'help', () => btnHelp.click(), ['more', 'help']);
        if (btnImportMermaid && !btnImportMermaid.hidden) {
          addItem('Import Mermaid', 'import', () => openMermaidImport(), ['more', 'import']);
        }
        [...exportMenu.children].forEach((node) => {
          if (node.hidden) return;
          if (node.classList.contains('menu-label')) {
            const lbl = document.createElement('div');
            lbl.className = 'menu-label';
            lbl.setAttribute('role', 'presentation');
            lbl.textContent = node.textContent;
            moreMenu.appendChild(lbl);
          } else if (node.matches('button[role="menuitem"]')) {
            const iconName = node.dataset.export ? 'export' : null;
            addItem(node.textContent, iconName, () => node.click());
          }
        });
      }
      function setMoreOpen(open) {
        if (!moreMenu || !btnMore) return;
        if (open) syncMoreMenu();
        animateMenuToggle(moreMenu, open, false);
        btnMore.setAttribute('aria-expanded', String(open));
      }
      // Arrow keys, Home/End, Escape and Tab navigation for popup menus
      function menuArrowKeys(menu, btn, setOpen) {
        const items = () => [...menu.querySelectorAll('[role^="menuitem"]')].filter((el) => !el.hidden && getComputedStyle(el).display !== 'none');
        menu.addEventListener('keydown', (e) => {
          if (menu.hidden) return;
          if (e.key === 'Tab') { setOpen && setOpen(false); return; }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen && setOpen(false); btn.focus(); return; }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
          const list = items();
          if (!list.length) return;
          e.preventDefault();
          const i = list.indexOf(document.activeElement);
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1
            : i < 0 ? (e.key === 'ArrowDown' ? 0 : list.length - 1)
            : (i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length;
          list[next].focus();
        });
        btn.addEventListener('keydown', (e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          if (menu.hidden && setOpen) setOpen(true);
          const list = items();
          if (list.length) list[e.key === 'ArrowDown' ? 0 : list.length - 1].focus();
        });
      }
      menuArrowKeys(exportMenu, btnExport, setExportOpen);
      if (moreMenu && btnMore) menuArrowKeys(moreMenu, btnMore, setMoreOpen);
      btnExport.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMermaidImport();
        setMoreOpen(false);
        const opening = exportMenu.hidden;
        setExportOpen(opening);
        if (opening && e.detail === 0) {
          const first = exportMenu.querySelector('[role^="menuitem"]:not([hidden])');
          if (first) first.focus();
        }
      });
      if (btnMore) btnMore.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMermaidImport();
        setExportOpen(false);
        const opening = moreMenu.hidden;
        setMoreOpen(opening);
        if (opening && e.detail === 0) {
          const first = moreMenu.querySelector('[role^="menuitem"]:not([hidden])');
          if (first) first.focus();
        }
      });
      exportMenu.addEventListener('click', (e) => {
        const b = e.target.closest('[data-export], [data-copy]');
        if (!b) return;
        setExportOpen(false);
        if (b.dataset.copy) copyDiagram(b.dataset.copy);
        else exportDiagram(b.dataset.export);
      });
      document.addEventListener('click', (e) => {
        setExportOpen(false);
        setMoreOpen(false);
        if (importEl && !importEl.contains(e.target) && !btnImportMermaid.contains(e.target)) closeMermaidImport();
      });
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        setExportOpen(false);
        setMoreOpen(false);
        closeMermaidImport();
      });

      // --- IMPORT MERMAID ---
      // The header's Import button (#btn-import-mermaid) and canvas paste (Ctrl+V outside text fields): the text is read
      // by the type's fromMermaid (mermaid.js) and replaces the diagram as one undo step, laid out fresh. What the reader
      // could not map exactly is listed afterwards, and text of another diagram type is refused.
      const MERMAID_TYPE_NAME = { flowchart: 'flowchart', usecase: 'use case diagram', sequence: 'sequence diagram', erd: 'ER diagram', c4: 'C4 diagram' };
      function mermaidTypeOf(text) {
        const body = String(text).replace(/^\s*---[\s\S]*?\n---[ \t]*(?:\n|$)/, '');
        const head = (body.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('%%')) || '').toLowerCase();
        if (/^(flowchart|graph)\b/.test(head)) return /^\s*%%\s*@type\s+usecase\b/m.test(body) ? 'usecase' : 'flowchart';
        if (head.startsWith('sequencediagram')) return 'sequence';
        if (head.startsWith('erdiagram')) return 'erd';
        if (/^c4(context|container|component|dynamic|deployment)\b/.test(head)) return 'c4';
        return '';
      }

      // Replaces the diagram with the Mermaid text; returns the reader's notes. Throws an Error with a plain message.
      function importMermaid(text) {
        if (!String(text).trim()) throw new Error('Paste some Mermaid text first.');
        const kind = mermaidTypeOf(text);
        if (kind && kind !== plugin.id) {
          throw new Error(`This is a ${MERMAID_TYPE_NAME[kind]}, and this page is a ${MERMAID_TYPE_NAME[plugin.id]}. Open a ${MERMAID_TYPE_NAME[kind]} page to import it.`);
        }
        let res;
        try { res = plugin.fromMermaid(text); } catch (err) { throw new Error(`This is not Mermaid text this page can read (${err.message}).`); }
        const next = res.data;
        if (!next.title && chartData.title) next.title = chartData.title;
        plugin.cancelInteraction();
        plugin.clearSelection();
        chartData = plugin.fromDisk ? plugin.fromDisk(next) : next;
        if (plugin.placeImported) plugin.placeImported();
        chartTitleEl.textContent = chartData.title || plugin.defaultTitle;
        document.title = chartTitleEl.textContent;
        plugin.render();
        updateStatus(true);
        fitView(true);
        const note = (list, label) => (list || []).map((m) => `${label}: ${String(m).replace(/^\[(?:INFO|WARN)\]\s*/, '')}`);
        return note(res.warnings, 'Warning').concat(note(res.infos, 'Note'));
      }

      let importEl = null;
      function closeMermaidImport() {
        if (!importEl) return false;
        motion.ghostExit(importEl, { duration: 110, transform: 'scale(0.94) translateY(-6px)', origin: 'top right' });
        importEl.remove();
        importEl = null;
        return true;
      }
      function positionImportBox(box) {
        const anchorEl = btnImportMermaid.getClientRects().length ? btnImportMermaid : (btnMore || btnExport);
        const anchor = anchorEl.getBoundingClientRect();
        const bw = box.offsetWidth;
        box.style.left = `${Math.max(8, Math.min(anchor.right - bw, innerWidth - bw - 8))}px`;
        box.style.top = `${anchor.bottom + 8}px`;
      }
      function showImportNotesBox(box, notes) {
        box.textContent = '';
        const add = (tag, cls, text) => { const d = document.createElement(tag); d.className = cls; if (text) d.textContent = text; box.appendChild(d); return d; };
        add('div', 'confirm-title', 'Imported, with notes');
        const list = add('ul', 'confirm-list');
        notes.forEach((n) => { const li = document.createElement('li'); li.textContent = n; list.appendChild(li); });
        const done = add('div', 'confirm-actions');
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'btn btn-primary confirm-ok';
        close.textContent = 'Close';
        close.addEventListener('click', closeMermaidImport);
        done.append(close);
        close.focus();
      }
      function openMermaidImport() {
        ui.closeConfirm();
        closeMermaidImport();
        const box = document.createElement('div');
        box.className = 'confirm confirm-wide';
        box.dataset.exportSkip = '';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-label', 'Paste Mermaid');
        const add = (tag, cls, text) => { const d = document.createElement(tag); d.className = cls; if (text) d.textContent = text; box.appendChild(d); return d; };
        const button = (cls, text) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; return b; };
        add('div', 'confirm-title', 'Paste Mermaid');
        add('div', 'confirm-msg', `Paste Mermaid text for this ${MERMAID_TYPE_NAME[plugin.id]}. It replaces the diagram and lays it out fresh. Undo brings the old diagram back.`);
        const field = add('textarea', 'confirm-field');
        field.spellcheck = false;
        field.setAttribute('aria-label', 'Mermaid text');
        const error = add('div', 'confirm-msg confirm-error');
        error.setAttribute('role', 'alert');
        error.hidden = true;
        const row = add('div', 'confirm-actions');
        const cancel = button('btn confirm-cancel', 'Cancel');
        cancel.addEventListener('click', closeMermaidImport);
        const ok = button('btn btn-primary confirm-ok', 'Import');
        row.append(cancel, ok);
        const run = () => {
          let notes;
          try { notes = importMermaid(field.value); } catch (err) { error.textContent = err.message; error.hidden = false; field.focus(); return; }
          if (!notes.length) { closeMermaidImport(); flashStatus('Imported Mermaid'); return; }
          showImportNotesBox(box, notes);
        };
        ok.addEventListener('click', (e) => { e.stopPropagation(); setExportOpen(false); setMoreOpen(false); run(); });
        box.addEventListener('click', (e) => { setExportOpen(false); setMoreOpen(false); e.stopPropagation(); });
        box.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') { e.preventDefault(); closeMermaidImport(); }
          else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
          if (e.key !== 'Tab') e.stopPropagation();   // keys typed here must not reach the diagram's shortcuts
        });
        document.body.appendChild(box);
        importEl = box;
        positionImportBox(box);
        if (motion.enabled()) {
          box.style.transformOrigin = 'top right';
          motion.anim(box, [
            { transform: 'scale(0.94) translateY(-6px)', clipPath: 'inset(0 0 25% 0 round 10px)' },
            { transform: 'none', clipPath: 'inset(0 0 0 0 round 10px)' }
          ], { duration: motion.dur('dur-base', 180), easing: motion.curve('curve-out') });
        }
        field.focus();
      }
      window.addEventListener('paste', (e) => {
        if (document.body.classList.contains('presentation') || !(plugin && typeof plugin.fromMermaid === 'function')) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
        if (!text.trim() || !mermaidTypeOf(text)) return;
        e.preventDefault();
        let notes;
        try { notes = importMermaid(text); } catch (err) { showToast(err.message); return; }
        if (!notes.length) { flashStatus('Imported Mermaid'); return; }
        ui.closeConfirm();
        closeMermaidImport();
        const box = document.createElement('div');
        box.className = 'confirm confirm-wide';
        box.dataset.exportSkip = '';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-label', 'Imported, with notes');
        box.addEventListener('keydown', (ev) => {
          if (ev.key === 'Escape') { ev.preventDefault(); closeMermaidImport(); }
          if (ev.key !== 'Tab') ev.stopPropagation();
        });
        document.body.appendChild(box);
        importEl = box;
        showImportNotesBox(box, notes);
        positionImportBox(box);
      });

      // --- DOCK: layout group, popovers, delete ---
      // Two groups split by a separator: editing controls (type buttons, Delete) | layout controls
      // (type buttons marked data-dock-group="layout", then Tidy).
      document.querySelectorAll('.toolbar-center [data-dock-group="layout"]').forEach(el => btnAutoTidy.before(el));

      // A [data-dock-pop] wrapper opens its .dock-pop bubble on hover (mouse/pen), or on click/tap/keyboard.
      // Its items can be anything; the grid width follows the item count (max 6 columns, then more rows). The bubble
      // may hold one .dock-pop-grid, or several in labelled .dock-pop-section blocks: every grid then takes the
      // column count of the largest, so the sections line up.
      const DOCK_POP_MAX_COLS = 6;
      document.querySelectorAll('[data-dock-pop]').forEach(wrap => {
        const trigger = wrap.querySelector('.dock-pop-trigger');
        const pop = wrap.querySelector('.dock-pop');
        if (!trigger || !pop) return;
        const items = [...pop.querySelectorAll('.dock-pop-grid > *')];
        const grids = [...pop.querySelectorAll('.dock-pop-grid')];
        const largest = Math.max(1, ...grids.map(g => g.children.length));
        const cols = Math.max(1, Math.min(largest, DOCK_POP_MAX_COLS));
        pop.style.setProperty('--pop-cols', cols);
        // Scroll only past 5 rows (60px tiles + 6px gaps ~ the grid's max height)
        grids.forEach(grid => grid.classList.toggle('scrolls', Math.ceil(grid.children.length / cols) > 5));
        items.forEach((el, i) => el.style.setProperty('--i', i));
        let closeTimer = null;
        const isOpen = () => wrap.classList.contains('open');
        // Keep the bubble inside the window: shift it sideways, the tail keeps pointing at the trigger
        function clampToWindow() {
          const t = trigger.getBoundingClientRect(), w = pop.offsetWidth, m = 8;
          const left = t.left + t.width / 2 - w / 2;
          const shift = Math.max(m - left, 0) + Math.min(innerWidth - m - (left + w), 0);
          pop.style.setProperty('--pop-shift', `${Math.round(shift)}px`);
        }
        function setOpen(open) {
          clearTimeout(closeTimer);
          if (open && trigger.disabled) return;
          if (open === isOpen()) return;
          if (open) clampToWindow();
          wrap.classList.toggle('open', open);
          trigger.setAttribute('aria-expanded', String(open));
        }
        const closeSoon = () => { clearTimeout(closeTimer); closeTimer = setTimeout(() => setOpen(false), 160); };
        wrap.addEventListener('pointerenter', (e) => {
          if (e.pointerType === 'touch' || document.body.classList.contains('palette-dragging')) return;
          setOpen(true);
        });
        wrap.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') closeSoon(); });
        // How a click was made: '' for keyboard (detail 0), else the pointer type of the press that caused it
        let lastPointerType = '';
        wrap.addEventListener('pointerdown', (e) => { lastPointerType = e.pointerType; });
        const clickKind = (e) => (e.detail === 0 ? '' : (e.pointerType || lastPointerType));
        const isHoverPointer = (k) => k === 'mouse' || k === 'pen';
        // Mouse clicks keep it open (hover already opened it); taps and Enter/Space toggle it
        trigger.addEventListener('click', (e) => setOpen(isHoverPointer(clickKind(e)) ? true : !isOpen()));
        // A mouse user may add several shapes in a row; tap and keyboard picks close the bubble
        pop.addEventListener('click', (e) => {
          const kind = clickKind(e);
          if (!e.target.closest('.dock-pop-grid > *') || isHoverPointer(kind)) return;
          setOpen(false);
          if (!kind) trigger.focus();
        });
        wrap.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); setOpen(false); trigger.focus(); }
        });
        wrap.addEventListener('focusout', (e) => { if (!wrap.contains(e.relatedTarget)) closeSoon(); });
        document.addEventListener('pointerdown', (e) => { if (isOpen() && !wrap.contains(e.target)) setOpen(false); }, true);
        window.addEventListener('resize', () => { if (isOpen()) clampToWindow(); });
      });

      // Delete: visible only while the plugin reports a deletable selection. Selection lives in the plugin, so
      // re-check after every input event (cheap) and every committed edit (undo/redo, add, delete).
      const btnDelete = document.getElementById('btn-delete-selection');
      let deleteCheckQueued = false;
      function refreshDeleteButton() {
        deleteCheckQueued = false;
        if (!btnDelete || !plugin) return;
        const on = !document.body.classList.contains('presentation') && !!(plugin.hasSelection && plugin.hasSelection());
        if (on === btnDelete.classList.contains('show')) return;
        if (!on) motion.ghostExit(btnDelete, { duration: 110, transform: 'scale(0.85)' });
        motion.flipDock(() => {
          btnDelete.classList.toggle('show', on);
          btnDelete.setAttribute('aria-hidden', String(!on));
          btnDelete.tabIndex = on ? 0 : -1;
        });
      }
      function queueDeleteRefresh() {
        if (deleteCheckQueued) return;
        deleteCheckQueued = true;
        requestAnimationFrame(refreshDeleteButton);
      }
      ['pointerup', 'click', 'keyup'].forEach(type => window.addEventListener(type, queueDeleteRefresh));
      if (btnDelete) btnDelete.addEventListener('click', () => {
        if (!btnDelete.classList.contains('show')) return;
        plugin.deleteSelection(btnDelete);
        queueDeleteRefresh();
      });

      // --- SAVE MECHANISM (Direct to HTML File) ---
      // Remember per-file handles and linked top-level workspace folders (IndexedDB) so reopened or
      // newly created diagrams inside a linked folder save straight back to disk without a file dialog.
      const FOLDER_STORE_LIMIT = 20;
      let dirPickerBlocked = false;   // flipped if the host rejects showDirectoryPicker as unsupported here
      function isEmbeddedFrame() {
        try { return window.self !== window.top; } catch (_) { return true; }
      }
      function isElectronHost() {
        return typeof window.acquireVsCodeApi === 'function' || /\b(Electron|Code)\b/i.test(navigator.userAgent || '');
      }
      function canPickSaveFile() {
        return 'showSaveFilePicker' in window && !isElectronHost();
      }
      function canPickDirectory() {
        if (dirPickerBlocked || !('showDirectoryPicker' in window)) return false;
        if (isEmbeddedFrame() || isElectronHost()) return false;
        return true;
      }
      function handleStorageKey() { return location.href.split(/[?#]/)[0]; }
      function handleDb() {
        return new Promise((resolve, reject) => {
          const req = indexedDB.open('ultimate-diagram', 2);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
            if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { autoIncrement: true });
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      }
      function readHandleByKey(db, key) {
        return new Promise((resolve, reject) => {
          const r = db.transaction('handles').objectStore('handles').get(key);
          r.onsuccess = () => resolve(r.result || null);
          r.onerror = () => reject(r.error);
        });
      }
      async function readStoredHandle() {
        try {
          const db = await handleDb();
          const key = handleStorageKey();
          const h = await readHandleByKey(db, key);
          if (h || key === location.href) return h;
          return await readHandleByKey(db, location.href);
        } catch (_) { return null; }
      }
      async function loadStoredHandle() {
        try {
          const h = await readStoredHandle();
          if (!h) return null;
          const opts = { mode: 'readwrite' };
          if ((await h.queryPermission(opts)) === 'granted') return h;
          // The browser forgets the permission when it closes: say why it asks before its prompt shows
          showToast(`Your browser asks once per session to let this page edit ${h.name}.`);
          if ((await h.requestPermission(opts)) === 'granted') return h;
        } catch (_) {}
        return null;
      }
      async function storeHandle(h) {
        try {
          const db = await handleDb();
          db.transaction('handles', 'readwrite').objectStore('handles').put(h, handleStorageKey());
        } catch (_) {}
      }
      async function readStoredFolders() {
        try {
          const db = await handleDb();
          if (!db.objectStoreNames.contains('folders')) return [];
          return await new Promise((resolve, reject) => {
            const out = [];
            const r = db.transaction('folders').objectStore('folders').openCursor(null, 'prev');
            r.onsuccess = () => {
              const cur = r.result;
              if (!cur) { resolve(out); return; }
              if (cur.value) out.push({ key: cur.key, handle: cur.value });
              cur.continue();
            };
            r.onerror = () => reject(r.error);
          });
        } catch (_) { return []; }
      }
      async function storeFolderHandle(dir) {
        try {
          const existing = await readStoredFolders();
          for (const item of existing) {
            if (item.handle && typeof item.handle.isSameEntry === 'function') {
              try { if (await item.handle.isSameEntry(dir)) return; } catch (_) {}
            }
          }
          const db = await handleDb();
          const tx = db.transaction('folders', 'readwrite');
          const store = tx.objectStore('folders');
          store.add(dir);
          // Trim oldest entries beyond the cap (existing is newest-first)
          for (const stale of existing.slice(FOLDER_STORE_LIMIT - 1)) store.delete(stale.key);
        } catch (_) {}
      }
      function extractDataBlockText(htmlText) {
        const openTag = '<script id="diagram-data" type="application/' + 'json">';
        const closeTag = '<' + '/script>';
        const start = htmlText.indexOf(openTag);
        if (start < 0) return null;
        const bodyStart = start + openTag.length;
        const end = htmlText.indexOf(closeTag, bodyStart);
        if (end < 0) return null;
        return htmlText.slice(bodyStart, end).trim().replace(/\r\n?/g, '\n');
      }
      function localPathSegments(loc) {
        const raw = loc.file.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '').replace(/^\/+/, '');
        return raw.split('/').filter(Boolean);
      }
      function sameSegment(a, b, win) {
        return win ? a.toLowerCase() === b.toLowerCase() : a === b;
      }
      async function resolveFileInFolder(dir, loc, { askPermission = false } = {}) {
        if (!dir || !dir.name || !loc) return null;
        const segs = localPathSegments(loc);
        const matches = [];
        for (let i = 0; i < segs.length - 1; i++) {
          if (sameSegment(segs[i], dir.name, loc.win)) matches.push(i);
        }
        if (!matches.length) return null;
        const opts = { mode: 'readwrite' };
        try {
          const curPerm = typeof dir.queryPermission === 'function' ? await dir.queryPermission(opts) : 'granted';
          if (curPerm !== 'granted') {
            if (!askPermission || typeof dir.requestPermission !== 'function') return null;
            showToast(`Your browser asks once per session to edit files in ${dir.name}.`);
            if ((await dir.requestPermission(opts)) !== 'granted') return null;
          }
        } catch (_) { return null; }

        for (const idx of matches) {
          try {
            let cur = dir;
            for (let j = idx + 1; j < segs.length - 1; j++) {
              cur = await cur.getDirectoryHandle(segs[j]);
            }
            const fh = await cur.getFileHandle(segs[segs.length - 1]);
            // Verify on-disk diagram-data matches what this page originally loaded, so same-named folders can never collide
            if (initialDataText !== null && typeof fh.getFile === 'function') {
              const diskText = await (await fh.getFile()).text();
              const diskData = extractDataBlockText(diskText);
              if (diskData !== initialDataText) continue;
            }
            return fh;
          } catch (_) { /* try next candidate segment */ }
        }
        return null;
      }
      async function loadFromLinkedFolders(loc, { askPermission = true } = {}) {
        if (!loc) return null;
        const folders = await readStoredFolders();
        for (const item of folders) {
          const fh = await resolveFileInFolder(item.handle, loc, { askPermission });
          if (fh) return fh;
        }
        return null;
      }

      // JSON with one line per flat object (a lane, a node, an edge, a layout entry), so the data block reads as a
      // list. A container is flat when its values are scalars or arrays of scalars; the top level always expands.
      // scripts/disk_format.py format_json() writes the same text.
      function formatJson(v, indent = '') {
        const scalar = (x) => x === null || typeof x !== 'object';
        if (scalar(v)) return JSON.stringify(v);
        const isObj = !Array.isArray(v);
        const items = isObj ? Object.entries(v).filter(([, x]) => x !== undefined) : v.map(x => [null, x]);
        if (!items.length) return isObj ? '{}' : '[]';
        const key = (k) => (k === null ? '' : JSON.stringify(k) + ': ');
        const flat = items.every(([, x]) => scalar(x) || (Array.isArray(x) && x.every(scalar)));
        if (indent && flat) {
          const inline = (x) => (scalar(x) ? JSON.stringify(x) : `[${x.map(y => JSON.stringify(y)).join(', ')}]`);
          const body = items.map(([k, x]) => key(k) + inline(x)).join(', ');
          return isObj ? `{ ${body} }` : `[${body}]`;
        }
        const inner = indent + '  ';
        const body = items.map(([k, x]) => inner + key(k) + formatJson(x, inner)).join(',\n');
        return (isObj ? '{' : '[') + '\n' + body + '\n' + indent + (isObj ? '}' : ']');
      }

      // Text for HTML element content (same escaping as Python's html.escape(s, quote=False))
      function escapeHtml(text) {
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }

      // The reading guide on line 2 names the data block's line range ("on lines S-E of this file", "Read lines
      // 1-E", "limit E", "after line E"); recompute it from the text being saved. Only the guide line is
      // rewritten, so this code's own text is never touched. Mirrors stamp_reading_guide() in disk_format.py.
      function stampReadingGuide(html) {
        const g = html.indexOf('<!-- For agents:');
        const o = html.indexOf('<script id="diagram-data" type="application\/json">');
        const e = html.indexOf('<!-- end diagram-' + 'data -->');
        if (g < 0 || o < 0 || e < 0) return html;
        let gEnd = html.indexOf('\n', g);
        if (gEnd < 0) gEnd = html.length;
        const lineOf = (i) => html.slice(0, i).split('\n').length;
        const start = lineOf(o), end = lineOf(e);
        const line = html.slice(g, gEnd)
          .replace(/on lines \d+-\d+ of this file/, `on lines ${start}-${end} of this file`)
          .replace(/(Read lines 1-|limit |after line )\d+/g, (_, p) => p + end);
        return html.slice(0, g) + line + html.slice(gEnd);
      }

      // The text of this page as it was loaded: the file itself where the browser lets us fetch it, else the live document
      // The live document as text, without the view-only search classes.
      function withoutSearchMarks(n) {
        if (!n.outerHTML) return '';
        const c = n.cloneNode(true);
        c.querySelectorAll('.search-dim, .search-current').forEach(el => el.classList.remove('search-dim', 'search-current'));
        return c.outerHTML;
      }

      async function loadSourceText() {
        let fullHtml = "";
        try {
          const res = await fetch(window.location.href);
          if (res.ok) {
            fullHtml = await res.text();
          }
        } catch (_) {}

        if (!fullHtml || !fullHtml.includes('id="diagram-data"')) {
          // Rebuild from the live document, keeping the top-level comments (the reading guide on line 2)
          fullHtml = [...document.childNodes].map(n => n.nodeType === Node.DOCUMENT_TYPE_NODE ? '<!DOCTYPE html>'
            : n.nodeType === Node.COMMENT_NODE ? `<!--${n.data}-->` : withoutSearchMarks(n)).join('\n');
        }
        return fullHtml;
      }

      function buildDiskData() {
        chartData.title = chartTitleEl.textContent.trim();
        const disk = plugin.toDisk ? plugin.toDisk(chartData) : { ...chartData };
        delete disk._readme;
        return dataReadme === null ? disk : { _readme: dataReadme, ...disk };
      }

      function serializeDiagramJson() {
        return formatJson(buildDiskData());
      }

      // The document to store: `sourceText` (this page's text) with the model, title and reading guide updated.
      // Shared by the file and artifact writers; only the source text differs.
      function buildSavedHtml(sourceText) {
        const updatedJson = serializeDiagramJson();

        // Both patterns spell the full tag with type="application\/json": this file's own source contains
        // these regexes, and with the escaped slash they cannot match their own text. A shorter pattern such
        // as <script id="render-report"[\s\S]*?<\/script> matches this code itself and deletes the rest of
        // the page's main script, so the saved file opens with nothing working.
        const fullHtml = sourceText.replace(/<script id="render-report" type="application\/json">[\s\S]*?<\/script>/, '');

        // A replacement function, not a string: labels may contain $&, $' or $` that a string would expand
        // The page title (<title> and the header's <h1>) follows the diagram title. Both come before the main
        // script, so the first match is the real element; closing tags are spelled <\/...> like the patterns above.
        const pageTitle = escapeHtml(chartData.title || plugin.defaultTitle);
        const replacedHtml = stampReadingGuide(fullHtml
          .replace(
            /(<script id="diagram-data" type="application\/json">)[\s\S]*?(<\/script>)/,
            (_, open, close) => `${open}\n${updatedJson}\n  ${close}`
          )
          .replace(/(<title>)[\s\S]*?(<\/title>)/, (_, open, close) => `${open}${pageTitle}${close}`)
          .replace(/(<h1 id="chart-title"[^>]*>)[\s\S]*?(<\/h1>)/, (_, open, close) => `${open}${pageTitle}${close}`));

        const dataEl = document.getElementById('diagram-data');
        if (dataEl) dataEl.textContent = `\n${updatedJson}\n  `;
        return replacedHtml;
      }

      // The artifact-shaped document for the current state, built from the pristine copy of the page
      function buildArtifactHtml() {
        return buildSavedHtml(ARTIFACT_HEAD + pristineBody + ARTIFACT_TAIL);
      }

      // File shape of an artifact document (for Export > HTML file fallback on legacy inline artifacts): the title,
      // reading guide, data block and styles go back into <head> in the order shell.html has them.
      function artifactToFileHtml(doc) {
        const body = doc.slice(ARTIFACT_HEAD.length, doc.length - ARTIFACT_TAIL.length);
        const m = /^\s*(<title>[\s\S]*?<\/title>)\n(<!--[\s\S]*?-->)\n([\s\S]*?<\/style>)([\s\S]*)$/.exec(body);
        if (!m) return doc;
        return stampReadingGuide('<!DOCTYPE html>\n' + m[2] + '\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n' +
          '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  ' + m[1] + '\n' + m[3] +
          '\n</head>\n<body>' + m[4].replace(ARTIFACT_END_MARKER + '\n', '') + '</body>\n</html>\n');
      }

      // Assemble a self-contained --target file HTML document from split artifact assets and live diagram data.
      async function buildExportHtmlFile() {
        const [cssText, jsText] = await Promise.all([
          fetch('app.css').then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status} fetching app.css`);
            return r.text();
          }),
          fetch('app.js').then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status} fetching app.js`);
            return r.text();
          })
        ]);
        const jsonText = serializeDiagramJson();
        const pageTitle = escapeHtml(chartData.title || plugin.defaultTitle);
        const guide =
          '<!-- For agents' + ': the whole diagram is the JSON (application/json) in the "diagram-data" script on lines 0-0 of this file. Read lines 1-0 only (offset 1, limit 0); everything after line 0 is editor code (CSS, JS, icons) and says nothing about the diagram.\n' +
          '     The model\'s first key, "_readme", says how to read it. The "end diagram-data" comment marks the true end: if it is not on the line named above (the JSON was edited by hand since the last save), trust the comment. To print just the model:\n' +
          '     sed -n \'/<script id="diagram-data" type="application\\/json">/,/<\\/script>/p\' FILE\n' +
          '     python -c "import re,sys;print(re.search(r\'<script id=\\"diagram-data\\" type=\\"application\\/json\\">(.*?)<\\/script>\',open(sys.argv[1],encoding=\'utf8\').read(),re.S)[1])" FILE -->';
        const closeScript = '<' + '/script>';
        const dataOpen = '<script id="diagram-data" type="application/' + 'json">';
        const dataEnd = '<!-- end diagram-' + 'data -->';
        const themeBlock = capturedThemeJson
          ? `\n  <script id="diagram-theme" type="application/${'json'}">${capturedThemeJson.replace(/</g, '\\u003c')}${closeScript}`
          : '';
        const fontBlock = capturedFontLinks ? `\n${capturedFontLinks}` : '';
        const bodyMarkup = (pristineScaffoldHtml || '\n')
          .replace(/(<h1 id="chart-title"[^>]*>)[\s\S]*?(<\/h1>)/, (_, open, close) => `${open}${pageTitle}${close}`);
        const html = '<!DOCTYPE html>\n' + guide + '\n<html lang="en">\n' +
          '<head>\n' +
          '  <meta charset="UTF-8">\n' +
          '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
          `  <title>${pageTitle}</title>\n` +
          '  <!-- Diagram model: the source of truth for this page. Everything after this block is the editor. -->\n' +
          `  ${dataOpen}\n${jsonText}\n  ${closeScript}\n` +
          `  ${dataEnd}${themeBlock}${fontBlock}\n` +
          '  <style>\n' + cssText.trimEnd() + '\n  </style>\n' +
          '</head>\n' +
          '<body>' + bodyMarkup +
          '\n  <script>\n' + jsText.trimEnd() + `\n  ${closeScript}\n` +
          '</body>\n</html>\n';
        return stampReadingGuide(html);
      }

      async function downloadHtmlFile() {
        if (!artifactMode) return;
        try {
          const html = document.getElementById('diagram-data')
            ? artifactToFileHtml(buildArtifactHtml())
            : await buildExportHtmlFile();
          await deliverFile(exportFileName('html'), new Blob([html], { type: 'text/html' }));
        } catch (err) {
          showToast('Download failed: ' + (err && err.message || err));
        }
      }

      async function publishToArtifact() {
        if (publishing || !artifactApi) return;
        publishing = true;   // held until the whole attempt, including the one retry and its delay, is over
        let skipIndex = false;
        btnSave.disabled = true;
        try {
          for (let attempt = 0; ; attempt++) {
            let diagramJson, snapshot;
            const files = {};
            try {
              diagramJson = serializeDiagramJson() + '\n';
              snapshot = JSON.stringify(chartData);   // what this publish carries; an edit made while it runs is not in it
              files[embedDir + 'diagram.json'] = diagramJson;
              // The artifact's own title (listing, tab) is the <title> of index.html: when the diagram was renamed, carry the
              // new name there too. The copy this view loaded is what it fetches, so only the title can differ from the live page.
              const title = chartData.title || plugin.defaultTitle;
              if (title !== publishedTitle && !skipIndex && !embedDir) {   // an embed leaves the host's title alone
                try {
                  const r = await fetch('index.html');
                  if (r.ok) {
                    const page = await r.text();
                    const next = page.replace(/(<title>)[\s\S]*?(<\/title>)/, (_, open, close) => open + escapeHtml(title) + close);
                    if (next !== page) files['index.html'] = next;
                  }
                } catch (_) { /* the data still saves; the artifact keeps its old title */ }
              }
              // No per-file ifMatch on purpose: a files publish without it keeps the whole-version check, so a save over
              // someone else's newer version is a `conflict` (nothing published, the view reloads) and never a silent overwrite.
              // ifMatch needs a sha256 the host reported, and the host only reports one on a call that already sent an ifMatch.
              await artifactApi.publish(files);
              document.title = title;
              publishedTitle = title;
              savedJson = snapshot;
              everSaved = true;
              updateStatus(false);
              motion.pulseEl(btnSave.querySelector('svg'));
              if (JSON.stringify(chartData) !== snapshot) updateStatus(true);   // edited mid-publish: still unsaved
              return;
            } catch (err) {
              // Branch on err.code only (runtime contract: the message is not stable). Unknown codes count as upstream_error.
              const KNOWN = ['conflict', 'not_writer', 'not_declared', 'too_large', 'invalid_content', 'read_only_path', 'rate_limited',
                             'consent_required', 'upstream_error', 'not_granted', 'capability_disabled', 'capability_removed', 'transform_error'];
              const code = err && KNOWN.includes(err.code) ? err.code : 'upstream_error';
              if (files['index.html'] && (code === 'invalid_content' || code === 'read_only_path')) { skipIndex = true; continue; }   // keep the data save; leave the title
              if (code === 'conflict') {
                // Someone else saved first. This view is already reloading to their version: no retry, no "unsaved" prompt
                reloadExpected = true;
                showToast('Someone else saved first. Showing their version.');
              } else if (['not_writer', 'not_granted', 'not_declared', 'consent_required', 'capability_disabled',
                          'capability_removed', 'read_only_path'].includes(code)) {
                // Read-only for this view, permanently: hide Save, point to Export > HTML file
                artifactMode = 'view-only';
                applyArtifactUi();
                showToast('Saving is not available here. Use Export > HTML file.');
              } else if (code === 'rate_limited') {
                showToast('Saving too often. Wait a moment, then save again.');
              } else if (code === 'too_large') {
                showToast('This diagram is too large to save to the artifact. Use Export > HTML file instead.');
              } else if (code === 'upstream_error' && attempt === 0) {
                // The one retryable failure: once more, after a short random delay
                await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
                continue;
              } else {
                showToast('Save failed (' + code + '): ' + ((err && err.message) || 'unknown error'));
              }
              return;
            }
          }
        } finally {
          publishing = false;
          if (artifactMode === 'publish') btnSave.disabled = false;
        }
      }

      // The opened file's own location, when the page was opened from disk (file://): { file, folder, name, win }.
      // Windows paths (file:///C:/... and UNC file://server/share/...) come back with backslashes.
      function localFilePath() {
        if (location.protocol !== 'file:') return null;
        let p;
        try { p = decodeURIComponent(location.pathname); } catch (_) { return null; }
        const win = !!location.host || /^\/[A-Za-z]:\//.test(p);
        if (location.host) p = '//' + location.host + p;
        if (win) p = p.replace(/^\/(?=[A-Za-z]:)/, '').replace(/\//g, '\\');
        const sep = win ? '\\' : '/';
        const i = p.lastIndexOf(sep);
        if (i < 0 || !/\.html?$/i.test(p)) return null;
        return { file: p, folder: p.slice(0, i) || sep, name: p.slice(i + 1), win };
      }

      // Copy text from inside a click. Try the async clipboard first, falling back to execCommand when missing or rejected.
      function copyText(text) {
        const legacyCopy = () => {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
          document.body.appendChild(ta);
          ta.select();
          let ok = false;
          try { ok = document.execCommand('copy'); } catch (_) {}
          ta.remove();
          return ok;
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(text).then(() => true, legacyCopy);
        }
        return Promise.resolve(legacyCopy());
      }

      // Before the first Save dialog of a file opened from disk: copy the file's path right away (the Save click allows it)
      // and show it, so the user can paste it into the dialog and save over the original instead of making a copy elsewhere.
      // Where directory picking is available, offer Link folder as the primary one-time setup (and copy the parent folder
      // when clicked so the user can paste it straight into the folder picker).
      async function askSaveLocation(loc, choose, linkFolder) {
        const plat = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '').toLowerCase();
        const mac = !loc.win && /mac/.test(plat);
        // macOS "Go to folder" takes a folder (the name is already filled in); Windows and GTK file boxes take the whole path
        const text = mac ? loc.folder : loc.file;
        const copied = await copyText(text);
        const where = loc.win
          ? 'paste in File name (Ctrl+A, Ctrl+V), Save, and overwrite.'
          : mac
            ? 'press \u2318\u21e7G, paste (\u2318V) + Return, Save, and overwrite.'
            : 'press Ctrl+L, paste (Ctrl+V), Save, and overwrite.';
        const extra = document.createDocumentFragment();
        const path = document.createElement('code');
        path.className = 'save-where';
        path.textContent = text;
        extra.appendChild(path);
        if (linkFolder) {
          const addTip = (lead, body) => {
            const p = document.createElement('div');
            p.className = 'save-folder-tip';
            const b = document.createElement('strong');
            b.textContent = lead;
            p.append(b, body);
            extra.appendChild(p);
          };
          addTip('Link folder: ', 'copies this file\u2019s folder to paste. Pick it (or a higher project folder) once so diagrams inside save in one click.');
          addTip('Choose file: ', copied ? 'path copied \u2014 ' + where : 'copy path, ' + where);
          ui.confirm(btnSave, {
            label: 'Save over the file you opened',
            title: 'Save to disk',
            message: 'Link a project folder once, or pick just this file.',
            extra,
            alt: { text: 'Choose file\u2026', onClick: choose },
            ok: 'Link folder\u2026',
            okClass: 'btn-primary'
          }, linkFolder);
          return;
        }
        ui.confirm(btnSave, {
          label: 'Save over the file you opened',
          title: copied ? 'Path copied' : 'Save over this file',
          message: copied ? where[0].toUpperCase() + where.slice(1) : 'Copy path, ' + where,
          extra,
          ok: 'Choose\u2026',
          okClass: 'btn-primary'
        }, choose);
      }

      async function writeToHandle(handle, replacedHtml) {
        const writable = await handle.createWritable();
        await writable.write(replacedHtml);
        await writable.close();

        savedJson = JSON.stringify(chartData);
        everSaved = true;
        updateStatus(false);
        motion.pulseEl(btnSave.querySelector('svg'));
      }

      async function linkFolderAndSave(loc, replacedHtml) {
        // Copy this diagram's parent folder so the user can paste it straight into the folder picker
        await copyText(loc.folder);
        let dir;
        try {
          dir = await window.showDirectoryPicker({ id: 'ultimate-diagram-root', mode: 'readwrite' });
        } catch (err) {
          if (!err || err.name === 'AbortError') return;
          const msg = err.message || '';
          if (/system files|sensitive/i.test(msg)) {
            showToast('Your browser blocks system folders (like Downloads or C:\\). Pick a project subfolder instead.');
          } else if (err.name === 'SecurityError') {
            dirPickerBlocked = true;
            showToast('Folder linking is not supported in this browser window. Open the diagram in Chrome or Edge to link a folder.');
          } else {
            showToast('Could not link folder: ' + (msg || err.name));
          }
          return;
        }
        const fh = await resolveFileInFolder(dir, loc, { askPermission: true });
        if (!fh) {
          showToast(`${dir.name} does not contain ${loc.name}. Pick a folder that contains this file.`);
          return;
        }
        await storeFolderHandle(dir);
        fileHandle = fh;
        storeHandle(fh);
        try {
          await writeToHandle(fh, replacedHtml);
          showToast(`Linked ${dir.name} \u2014 diagrams in it and its subfolders will save directly.`);
        } catch (err) {
          if (err && err.name === 'AbortError') return;
          showToast('Save failed: ' + ((err && err.message) || err));
        }
      }

      async function pickSaveFile() {
        // Browsers cannot read a page's own folder, so reuse the current file name
        // (saving over it) and a stable picker id so the dialog reopens in the
        // last folder used for diagrams.
        let currentName = '';
        try {
          currentName = decodeURIComponent(location.pathname.split('/').pop() || '');
        } catch (_) {}
        const suggested = /\.html?$/i.test(currentName)
          ? currentName
          : (chartData.title || plugin.id).toLowerCase().replace(/[^a-z0-9_-]/g, '-') + '.html';
        return window.showSaveFilePicker({
          id: 'ultimate-diagram-save',
          suggestedName: suggested,
          types: [{
            description: 'HTML Diagram File',
            accept: { 'text/html': ['.html'] }
          }]
        });
      }

      async function writeFile(replacedHtml, picked) {
        if (canPickSaveFile()) {
          let pickedNow = false;
          try {
            if (!fileHandle && !picked) fileHandle = await loadStoredHandle();
            const loc = !fileHandle && !picked ? localFilePath() : null;
            if (!fileHandle && loc && canPickDirectory()) {
              fileHandle = await loadFromLinkedFolders(loc, { askPermission: true });
              if (fileHandle) storeHandle(fileHandle);
            }
            if (!fileHandle) {
              if (loc) {
                // The dialog has to open from a fresh click: the bubble's buttons call back here
                const linkFolder = canPickDirectory()
                  ? () => linkFolderAndSave(loc, replacedHtml)
                  : null;
                askSaveLocation(loc, () => writeFile(replacedHtml, true), linkFolder);
                return;
              }
              fileHandle = await pickSaveFile();
              pickedNow = true;
            }

            await writeToHandle(fileHandle, replacedHtml);
            if (pickedNow) storeHandle(fileHandle);
            return;
          } catch (err) {
            if (err && err.name === 'AbortError') return;
            if (pickedNow) {
              fileHandle = null;
              showToast('Could not overwrite file directly: ' + ((err && err.message) || err));
              return;
            }
          }
        }

        try {
          const blob = new Blob([replacedHtml], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = (chartData.title || plugin.id).toLowerCase().replace(/[^a-z0-9_-]/g, '-') + '.html';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          savedJson = JSON.stringify(chartData);
          everSaved = true;
          updateStatus(false);
          if (!downloadToldOnce) {
            // The download is a copy: say so once, so nobody reopens the old file expecting their edits
            downloadToldOnce = true;
            showToast(location.protocol === 'file:'
              ? 'Saved a copy to your downloads folder. The file you opened was not changed.'
              : 'Saved a copy to your downloads folder.');
          }
        } catch (err) {
          alert("Save failed: " + err.message);
        }
      }

      const HELPER_PORTS = [19847, 19848, 19849, 19850, 19851];

      function getDiagramSaveId() {
        const meta = document.querySelector('meta[name="diagram-save-id"]');
        const val = meta ? (meta.getAttribute('content') || '').trim() : '';
        return /^[0-9a-f]{32}$/.test(val) ? val : '';
      }

      function isLoopbackPreviewOrigin() {
        return location.protocol === 'http:' && (location.hostname === '127.0.0.1' || location.hostname === 'localhost');
      }

      function helperPortsToProbe() {
        const override = Array.isArray(window.__ULTIMATE_DIAGRAM_HELPER_PORTS__)
          ? window.__ULTIMATE_DIAGRAM_HELPER_PORTS__
          : null;
        return override && override.length ? override : HELPER_PORTS;
      }

      async function fetchWithTimeout(url, opts, ms) {
        const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
        try {
          return await fetch(url, ctrl ? { ...opts, signal: ctrl.signal } : opts);
        } finally {
          if (timer) clearTimeout(timer);
        }
      }

      async function findHelperPort() {
        const ports = helperPortsToProbe();
        for (const port of ports) {
          try {
            const resp = await fetchWithTimeout(`http://127.0.0.1:${port}/health`, { method: 'GET' }, 300);
            if (!resp.ok) continue;
            const info = await resp.json();
            if (info && info.ok && info.app === 'ultimate-diagram-save-helper') return port;
          } catch (_) {}
        }
        return null;
      }

      async function postSaveToHelper(port, payload) {
        const resp = await fetchWithTimeout(`http://127.0.0.1:${port}/save`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Ultimate-Diagram-Save': '1'
          },
          body: JSON.stringify(payload)
        }, 3000);
        if (!resp.ok) return null;
        const body = await resp.json();
        return body && body.ok ? body : null;
      }

      async function saveViaLocalHelper() {
        if (playground || claudeHost) return false;
        const isLocalFile = location.protocol === 'file:';
        if (!isLocalFile && !isLoopbackPreviewOrigin()) return false;
        const saveId = getDiagramSaveId();
        if (!saveId) return false;

        const loc = isLocalFile ? localFilePath() : null;
        const diskData = buildDiskData();
        const title = chartData.title || plugin.defaultTitle;
        const payload = { path: loc ? loc.file : null, saveId, data: diskData, title };

        let result = null;
        if (helperPort !== null) {
          try { result = await postSaveToHelper(helperPort, payload); } catch (_) { result = null; }
          if (!result) helperPort = null;
        }
        if (!result) {
          const port = await findHelperPort();
          if (port === null) return false;
          try { result = await postSaveToHelper(port, payload); } catch (_) { result = null; }
          if (!result) return false;
          helperPort = port;
        }

        const updatedJson = formatJson(diskData);
        const dataEl = document.getElementById('diagram-data');
        if (dataEl) dataEl.textContent = `\n${updatedJson}\n  `;
        if (title) document.title = title;
        helperSavedName = result.name || (loc && loc.name) || 'diagram.html';
        savedJson = JSON.stringify(chartData);
        everSaved = true;
        updateStatus(false);
        motion.pulseEl(btnSave.querySelector('svg'));
        return true;
      }

      async function saveToFile() {
        if (playground) {
          try {
            await deliverFile(exportFileName('html'), new Blob([await buildExportHtmlFile()], { type: 'text/html' }));
            savedJson = JSON.stringify(chartData);
            everSaved = true;
            updateStatus(false);
          } catch (err) { showToast('Download failed: ' + (err && err.message || err)); }
          return;
        }
        if (artifactMode === 'publish') return publishToArtifact();
        if (artifactMode === 'view-only') return downloadHtmlFile();
        if (artifactMode === 'pending') return;   // use() has not answered yet; Save is disabled until it does
        if (await saveViaLocalHelper()) return;
        const html = document.getElementById('diagram-data')
          ? buildSavedHtml(await loadSourceText())
          : await buildExportHtmlFile();
        await writeFile(html);
      }

      // --- CLAUDE.AI ARTIFACT: which Save this page has ---
      // use() resolves later (never during this first run) and gives null when this is not claude.ai, the capability
      // was not granted, or the viewer cannot write. The page renders without it and switches over when it answers.
      function applyArtifactUi() {
        btnSave.hidden = artifactMode === 'view-only';
        btnSave.disabled = artifactMode === 'pending' || publishing;
        btnSave.title = artifactMode === 'pending' ? 'Connecting to claude.ai...' : 'Save a new version of this artifact (Ctrl+S)';
        if (!exportMenu.querySelector('[data-export="html"]')) {
          const item = document.createElement('button');
          item.type = 'button'; item.setAttribute('role', 'menuitem'); item.dataset.export = 'html';
          item.textContent = 'HTML file (editable)';
          exportMenu.querySelector('[data-export="png"]').after(item);
        }
        setStatusBadge(hasUnsavedChanges);
      }

      if (claudeHost && playground) {
        Promise.resolve().then(() => claudeHost.use('downloads')).then(d => { downloadsApi = d || null; }, () => {});
      } else if (claudeHost) {
        const useNamespace = (name) => {
          try { return Promise.resolve(claudeHost.use(name)).then(v => v || null, () => null); }
          catch (_) { return Promise.resolve(null); }
        };
        applyArtifactUi();
        useNamespace('artifact').then(a => {
          artifactApi = a;
          artifactMode = a ? 'publish' : 'view-only';
          applyArtifactUi();
        });
        useNamespace('downloads').then(d => { downloadsApi = d; });
        window.addEventListener('beforeunload', (e) => {
          if (artifactMode === 'publish' && hasUnsavedChanges && !reloadExpected) { e.preventDefault(); e.returnValue = ''; }
        });
      }

      btnSave.addEventListener('click', saveToFile);
      // A file opened from disk that was saved before (or sits inside a linked workspace folder): show which file Save writes to
      if (!claudeHost && location.protocol === 'file:' && canPickSaveFile()) {
        readStoredHandle().then(async (h) => {
          if (h && h.name && !fileHandle) { storedName = h.name; setStatusBadge(hasUnsavedChanges); return; }
          if (!fileHandle && canPickDirectory()) {
            const loc = localFilePath();
            const fh = loc ? await loadFromLinkedFolders(loc, { askPermission: false }) : null;
            if (fh && fh.name && !fileHandle) { storedName = fh.name; setStatusBadge(hasUnsavedChanges); }
          }
        });
      }

      // --- PLAYGROUND: the header icon becomes a type menu ---
      if (playground) {
        const catchVt = (e) => { if (e.viewTransition) { e.viewTransition.finished.catch(() => {}); e.viewTransition.ready.catch(() => {}); } };
        window.addEventListener('pageswap', catchVt);
        window.addEventListener('pagereveal', catchVt);
        window.addEventListener('unhandledrejection', (e) => {
          if (e.reason && e.reason.name === 'AbortError' && /Transition was skipped/.test(e.reason.message || '')) e.preventDefault();
        });
        btnSave.title = 'Download this diagram as an HTML file (Ctrl+S)';
        const icon = document.querySelector('.toolbar-left > svg');
        const wrap = document.createElement('div');
        wrap.className = 'menu-wrap type-switch';
        const btn = document.createElement('button');
        btn.type = 'button'; btn.id = 'btn-type'; btn.className = 'btn type-btn';
        btn.title = 'Switch diagram type'; btn.setAttribute('aria-label', 'Diagram type');
        btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false');
        const menu = document.createElement('div');
        menu.id = 'type-menu'; menu.className = 'menu menu-left'; menu.setAttribute('role', 'menu'); menu.hidden = true;
        icon.replaceWith(wrap);
        const cur = playground.types.find((x) => x.id === playground.type);
        const curLabel = document.createElement('span'); curLabel.className = 'btn-label'; curLabel.textContent = cur.name;
        icon.remove();
        btn.append(ui.iconEl('type-' + cur.id, { size: 'sm' }), curLabel, ui.iconEl('chevron-down', { size: 'sm' }));
        wrap.append(btn, menu);
        const setOpen = (open) => { animateMenuToggle(menu, open, true); btn.setAttribute('aria-expanded', String(open)); };
        // The theme travels in the URL, so the next page matches even where storage is blocked; the spinner shows until it renders
        const goTo = (id) => { document.documentElement.classList.add('is-loading'); location.assign('../' + id + '/index.html?theme=' + currentTheme()); };
        window.addEventListener('pageshow', (e) => { if (e.persisted) document.documentElement.classList.remove('is-loading'); });
        for (const t of playground.types) {
          const item = document.createElement('button');
          item.type = 'button'; item.dataset.type = t.id; item.setAttribute('role', 'menuitemradio');
          const here = t.id === playground.type;
          item.setAttribute('aria-checked', String(here));
          item.append(ui.iconEl('type-' + t.id, { size: 'sm' }), t.name);
          if (here) item.appendChild(ui.iconEl('check', { size: 'sm', class: 'menu-check' }));
          item.addEventListener('click', () => {
            setOpen(false);
            if (here) return;
            if (!hasUnsavedChanges) { goTo(t.id); return; }
            const mine = playground.types.find((x) => x.id === playground.type).name;
            ui.confirm(btn, {
              label: 'Switch diagram type', title: 'Switch to ' + t.name + '?',
              message: 'Your edits to this ' + mine.toLowerCase() + ' are lost unless you save.', ok: 'Switch',
              alt: { text: 'Save', onClick: async () => { await saveToFile(); if (!hasUnsavedChanges) goTo(t.id); } }
            }, () => goTo(t.id));
          });
          menu.appendChild(item);
        }
        menuArrowKeys(menu, btn, setOpen);
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const opening = menu.hidden;
          setOpen(opening);
          if (opening && e.detail === 0) {
            const first = menu.querySelector('[role^="menuitem"]:not([hidden])');
            if (first) first.focus();
          }
        });
        document.addEventListener('click', () => setOpen(false));
        window.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
      }

      window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          if (!presentOn()) saveToFile();
        } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
          // Leave text editing (title, labels) to the browser's own undo
          if (document.activeElement && (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT')) return;
          if (document.body.classList.contains('presentation')) return;
          e.preventDefault();
          if (e.key.toLowerCase() === 'y' || e.shiftKey) redo(); else undo();
        } else if (e.key === 'Escape') {
          if (presentOn() && !document.body.classList.contains('capture')) { setPresent(false); return; }
          if (helpDrawer.classList.contains('open')) { setHelpOpen(false, true); return; }
          plugin.cancelInteraction();
        } else if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !typingInField() && !presentOn()) {
          e.preventDefault();
          setHelpOpen(!helpDrawer.classList.contains('open'), true);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          if (document.body.classList.contains('presentation')) return;
          if (document.activeElement && (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT')) {
            return;
          }
          plugin.deleteSelection();
        }
      });
//@engine-begin
      // --- SHARED ORTHOGONAL ROUTER ---
      // Pure JS, no DOM: the flowchart's arrow router, for every type that draws orthogonal arrows. A plain script
      // (globals only, no imports), joined into the page ahead of engine.js (ENGINE_JS in layout_engine.py) and loaded
      // ahead of it by scripts/run_engine.mjs and scripts/engine_runner.py. TOKENS is defined by the page or by those scripts.
      //
      // routeEdgesOrthogonal({ chartData, tb, boxes, laneDividers, loopSide, outlineInset, labelMaxW }) -> routes
      //   chartData     { nodes: [{ id, type, laneId? }], edges: [{ id, from, to, label?, feedback? }] }
      //   tb            true when the flow runs top to bottom: boxes are transposed before the search, polylines back after
      //   boxes         { nodeId: { x, y, w, h } } in screen px (a node without a box is skipped, and so are its arrows)
      //   laneDividers  screen offsets (along the flow axis) of the lane borders: a horizontal run on one costs more; [] for none
      //   loopSide      (edge) -> 'far' | 'near': the side a same-lane loop-back U-turns on (flowchart: loopSides())
      //   outlineInset  optional (node, box, side, along) -> px a shaped outline sits inside its box (0 for a plain box)
      //   labelMaxW     widest a wrapped edge label may be
      // Returns { edgeId: { path, points, midX, midY, fromRect, toRect } }; midX/midY is where the label pill goes.
      // Text widths come from TOKENS.font.metrics. Deterministic: the same input gives the same routes.
      // --- PLANAR ORTHOGONAL ROUTING & CHANNEL STAGGERING ENGINE ---
      // Top-to-bottom diagrams are routed in flow terms too: node boxes are transposed (x <-> y) before the route
      // search, so every rule written for a left-to-right flow applies unchanged, and the finished polylines are
      // transposed back before hops and labels are placed on screen (step 6).
      function routeEdgesOrthogonal(model) {
        const { chartData, tb, boxes, laneDividers, loopSide, outlineInset, labelMaxW } = model;
        const FONT_M = TOKENS.font.metrics;
        const rects = {};
        const nodeMap = {};

        chartData.nodes.forEach(n => {
          nodeMap[n.id] = n;
          const r = boxes[n.id];
          if (!r) return;
          const { x, y, w, h } = r;
          rects[n.id] = tb ? { x: y, y: x, w: h, h: w, cx: y + h / 2, cy: x + w / 2 } : { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
        });

        // True when an axis-aligned segment keeps 6px clear of every node except `ignore`
        // (route search calls this hundreds of thousands of times per render, so it is a plain loop)
        const rectList = Object.keys(rects).map(id => [id, rects[id]]);
        const segmentClear = (x1, y1, x2, y2, ignore) => {
          const minX = Math.min(x1, x2) - 6, maxX = Math.max(x1, x2) + 6;
          const minY = Math.min(y1, y2) - 6, maxY = Math.max(y1, y2) + 6;
          for (let k = 0; k < rectList.length; k++) {
            const r = rectList[k][1];
            if (r.x < maxX && r.x + r.w > minX && r.y < maxY && r.y + r.h > minY && !ignore.includes(rectList[k][0])) return false;
          }
          return true;
        };

        const verticalEntryUsed = {};
        const outEdges = {};
        const inEdges = {};
        chartData.nodes.forEach(n => { outEdges[n.id] = []; inEdges[n.id] = []; });

        const validEdges = chartData.edges.filter(e => rects[e.from] && rects[e.to]);
        validEdges.forEach(e => {
          outEdges[e.from].push(e);
          inEdges[e.to].push(e);
        });

        // 0. Backward arrows (target left of source): pick the exit/entry sides that give the
        // fewest bends over a route that stays clear of every other node. When no candidate is
        // clear, the legacy fixed rule below (left exit + bypass corridor / bottom U-turn) applies.
        const backPorts = {};
        const backRoute = (f, t, fp, tp, ids) => {
          let pts;
          if (fp === 'left' && tp === 'right') {
            const sx = f.x, sy = f.cy, ex = t.x + t.w, ey = t.cy;
            if (ex > sx - 12) return null;
            if (Math.abs(sy - ey) < 6) pts = [[sx, sy], [ex, sy]];
            else { const mx = (sx + ex) / 2; pts = [[sx, sy], [mx, sy], [mx, ey], [ex, ey]]; }
          } else if (fp === 'left' && tp === 'left') {  // left exit, wrap upstream into target's flow-entry port: two bends
            const sx = f.x, sy = f.cy, ex = t.x, ey = t.cy;
            for (const pad of [24, 14, 10]) {
              const gx = Math.min(sx, ex) - pad;
              if (gx < 8) continue;
              const cand = [[sx, sy], [gx, sy], [gx, ey], [ex, ey]];
              if (cand.slice(0, -1).every((p, i) => segmentClear(p[0], p[1], cand[i + 1][0], cand[i + 1][1], ids))) return 2;
            }
            return null;
          } else if (fp === 'left') {            // left exit, vertical entry into top/bottom: one bend
            const sx = f.x, sy = f.cy, ex = t.cx;
            const ey = tp === 'top' ? t.y : t.y + t.h;
            if (ex > sx - 20 || (tp === 'top' ? sy >= ey - 8 : sy <= ey + 8)) return null;
            pts = [[sx, sy], [ex, sy], [ex, ey]];
          } else if (tp === 'right') {           // vertical exit, side entry: one bend
            const sx = f.cx, sy = fp === 'top' ? f.y : f.y + f.h, ex = t.x + t.w, ey = t.cy;
            if (ex > sx - 20 || (fp === 'top' ? ey >= sy - 8 : ey <= sy + 8)) return null;
            pts = [[sx, sy], [sx, ey], [ex, ey]];
          } else if (fp === 'bottom' && tp === 'bottom') { // U-turn below both nodes: two bends
            const sx = f.cx, sy = f.y + f.h, ex = t.cx, ey = t.y + t.h;
            const g = Math.max(sy, ey) + 36;
            pts = [[sx, sy], [sx, g], [ex, g], [ex, ey]];
          } else if (fp === 'top' && tp === 'top') {       // U-turn above both nodes (a near-side loop, see loopSides)
            const sx = f.cx, sy = f.y, ex = t.cx, ey = t.y;
            const g = Math.min(sy, ey) - 36;
            pts = [[sx, sy], [sx, g], [ex, g], [ex, ey]];
          } else {
            return null;
          }
          for (let i = 0; i < pts.length - 1; i++) {
            if (!segmentClear(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], ids)) return null;
          }
          return pts.length - 2; // bends
        };
        // A same-lane loop-back U-turns on the side its lane reserved for it (the layout's loopSides rule)
        validEdges.forEach(e => {
          const f = rects[e.from], t = rects[e.to];
          if (!(t.cx < f.cx - 30)) return;
          const dy = t.cy - f.cy;
          const uTurn = nodeMap[e.from].laneId === nodeMap[e.to].laneId && loopSide(e) === 'near' ? 'top' : 'bottom';
          const legacy = dy > 30 ? { fromPort: 'left', toPort: 'top' }
            : dy < -30 ? { fromPort: 'left', toPort: 'bottom' }
            : { fromPort: uTurn, toPort: uTurn };
          // A side port is only reused when it is not already an exit/entry for a different role
          const leftExitFree = !inEdges[e.from].some(ie => ie !== e && rects[ie.from].cx < f.cx - 30 && Math.abs(rects[ie.from].cy - f.cy) <= 30);
          const rightEntryFree = !outEdges[e.to].some(o => o !== e && rects[o.to].cx >= t.cx - 30 && Math.abs(rects[o.to].cx - t.cx) >= 30);
          const cands = [];
          const sameRow = Math.abs(dy) <= 30;
          // If the target is a decision that sends a forward branch back toward this loopback's side, avoid
          // stealing that side vertex so the outgoing branch does not wrap around the back of the diamond.
          const decisionBranchOnSide = !sameRow && nodeMap[e.to] && nodeMap[e.to].type === 'decision'
            && (outEdges[e.to] || []).some(o => rects[o.to] && rects[o.to].cx >= t.cx - 30
              && (dy > 30 ? rects[o.to].cy < t.cy - 30 : rects[o.to].cy > t.cy + 30));
          if (rightEntryFree) {
            if (leftExitFree) cands.push(['left', 'right']);
            if (!sameRow) cands.push([dy < 0 ? 'top' : 'bottom', 'right']);
          }
          if (!sameRow && leftExitFree) {
            if (decisionBranchOnSide) cands.push(['left', 'left']);
            else cands.push(['left', dy < 0 ? 'bottom' : 'top']);
          }
          cands.push([uTurn, uTurn]);
          let best = null;
          cands.forEach(([fp, tp]) => {
            const bends = backRoute(f, t, fp, tp, [e.from, e.to]);
            if (bends === null) return;
            const isLegacy = fp === legacy.fromPort && tp === legacy.toPort;
            // Fewest bends wins; on a tie keep the legacy choice
            if (!best || bends < best.bends || (bends === best.bends && isLegacy)) best = { fromPort: fp, toPort: tp, bends };
          });
          backPorts[e.id] = best ? { fromPort: best.fromPort, toPort: best.toPort } : legacy;
        });

        // 1. Identify nodes that have a leftward loopback leaving their 'left' port
        const hasLeftLoopback = new Set();
        validEdges.forEach(e => {
          const bp = backPorts[e.id];
          if (bp && bp.fromPort === 'left' && Math.abs(rects[e.to].cy - rects[e.from].cy) > 30) {
            hasLeftLoopback.add(e.from);
          }
        });

        // 2. Assign departure and arrival ports per edge
        const edgePorts = {};
        Object.keys(outEdges).forEach(uId => {
          const uOuts = outEdges[uId];
          if (!uOuts.length) return;
          const f = rects[uId];
          const uNode = nodeMap[uId];
          const fwdOuts = [];

          uOuts.forEach(e => {
            const t = rects[e.to];
            if (t.cx < f.cx - 30) {
              edgePorts[e.id] = backPorts[e.id];
            } else {
              fwdOuts.push(e);
            }
          });

          const isMultiOrDecision = (uNode && uNode.type === 'decision') || fwdOuts.length > 1;
          const upCands = fwdOuts.filter(e => rects[e.to].cy < f.cy - 30).sort((a, b) => rects[a.to].cy - rects[b.to].cy);
          const downCands = fwdOuts.filter(e => rects[e.to].cy > f.cy + 30).sort((a, b) => rects[b.to].cy - rects[a.to].cy);
          // A target directly above/below gets the top/bottom exit (straight line); others leave via the side
          const alignedFirst = (list) => list.sort((a, b) => (Math.abs(rects[a.to].cx - f.cx) < 30 ? 0 : 1) - (Math.abs(rects[b.to].cx - f.cx) < 30 ? 0 : 1));
          alignedFirst(upCands);
          alignedFirst(downCands);

          // Unlabelled same-side parallel fork from a non-decision step keeps all branches on the flow exit/entry sides
          // so they share one orthogonal fork bus instead of splitting the furthest branch onto a side port.
          const isParallelFork = (cands) => (!uNode || uNode.type !== 'decision')
            && cands.length >= 2
            && cands.every(e => !(e.label || '').trim() && rects[e.to].x > f.x + f.w + 20);
          const upFork = isParallelFork(upCands);
          const downFork = isParallelFork(downCands);

          // A decision gives each branch its own vertex: a vertex already taken by a loop-back branch
          // is not reused for a forward one (it would leave the diamond's slanted sides, off the vertex)
          const backTaken = new Set(uNode && uNode.type === 'decision'
            ? uOuts.filter(e => !fwdOuts.includes(e)).map(e => edgePorts[e.id] && edgePorts[e.id].fromPort)
            : []);
          let topEdgeId = (!upFork && isMultiOrDecision && upCands.length > 0 && !backTaken.has('top')) ? upCands[0].id : null;
          let bottomEdgeId = (!downFork && isMultiOrDecision && downCands.length > 0 && !backTaken.has('bottom')) ? downCands[0].id : null;
          if (!upFork && !topEdgeId && upCands.length > 0 && !backTaken.has('top') && Math.abs(rects[upCands[0].to].cx - f.cx) < 30) {
            topEdgeId = upCands[0].id;
          }
          if (!downFork && !bottomEdgeId && downCands.length > 0 && !backTaken.has('bottom') && Math.abs(rects[downCands[0].to].cx - f.cx) < 30) {
            bottomEdgeId = downCands[0].id;
          }

          fwdOuts.forEach(e => {
            const t = rects[e.to];
            const inFork = (upFork && upCands.includes(e)) || (downFork && downCands.includes(e));
            let fromPort = 'right';
            if (e.id === topEdgeId) {
              fromPort = 'top';
            } else if (e.id === bottomEdgeId) {
              fromPort = 'bottom';
            }

            let toPort = 'left';
            if (hasLeftLoopback.has(e.to) && fromPort === 'right' && Math.abs(t.cy - f.cy) > 30) {
              toPort = (t.cy < f.cy) ? 'bottom' : 'top';
            } else if (fromPort === 'right' && fwdOuts.length === 1 && uNode && uNode.type !== 'decision') {
              // One step into another lane: leave via top/bottom for a single bend instead of a Z,
              // unless an incoming arrow already enters from that same side and a flow-side exit can single-bend
              const dy = t.cy - f.cy;
              const incomingSameSide = t.cx > f.x + f.w + 24 && (inEdges[uId] || []).some(o => {
                const s = rects[o.from];
                return s && (dy > 0 ? s.cy > f.cy + 30 : s.cy < f.cy - 30);
              });
              if (!incomingSameSide && Math.abs(dy) > 30 && (Math.abs(t.cx - f.cx) < 30 || t.x > f.cx + 40)) {
                const sy = dy > 0 ? f.y + f.h : f.y;
                if (segmentClear(f.cx, sy, f.cx, t.cy, [uId, e.to]) && segmentClear(f.cx, t.cy, t.x, t.cy, [uId, e.to])) {
                  fromPort = dy > 0 ? 'bottom' : 'top';
                }
              }
            }
            if ((fromPort === 'top' || fromPort === 'bottom') && Math.abs(t.cx - f.cx) < 30) {
              // Target sits directly above/below: straight vertical line
              toPort = (t.cy < f.cy) ? 'bottom' : 'top';
            } else if (!inFork && fromPort === 'right' && toPort === 'left' && Math.abs(t.cy - f.cy) > 30 && t.cx > f.x + f.w + 24) {
              // Side exit into a node in another lane that lies clearly to the right:
              // run along the source row, then enter the target from its bottom/top (one bend instead of two)
              const enterSide = t.cy < f.cy ? 'bottom' : 'top';
              const ey = enterSide === 'bottom' ? t.y + t.h : t.y;
              const sideKey = e.to + ':' + enterSide;
              // The run along the source row must not cut across the vertical trunk of a sibling fan-in
              // arrow: a source in a farther lane (same side) whose column lies between this source and
              // the target climbs straight up to the target's left port, so crossing it is unavoidable
              // here. Enter the left port instead (the sibling trunk then nests inside this route).
              // A sibling in the target's own column (|dx| < 30) climbs straight into the same
              // top/bottom port, so the row run would cut across it just the same.
              const cutsSiblingTrunk = (inEdges[e.to] || []).some(o => {
                if (o === e || !rects[o.from]) return false;
                const s = rects[o.from];
                const farther = enterSide === 'bottom' ? s.cy > f.cy + 30 : s.cy < f.cy - 30;
                return farther && s.cx > f.x + f.w && s.cx < t.cx + 30;
              });
              const decisionBranchOnEnter = nodeMap[e.to] && nodeMap[e.to].type === 'decision'
                && (outEdges[e.to] || []).some(o => rects[o.to]
                  && (enterSide === 'bottom' ? rects[o.to].cy > t.cy + 30 : rects[o.to].cy < t.cy - 30));
              if (!verticalEntryUsed[sideKey] && !cutsSiblingTrunk && !decisionBranchOnEnter
                  && segmentClear(f.x + f.w, f.cy, t.cx, f.cy, [uId, e.to])
                  && segmentClear(t.cx, f.cy, t.cx, ey, [uId, e.to])) {
                toPort = enterSide;
                verticalEntryUsed[sideKey] = true;
              }
            }
            edgePorts[e.id] = { fromPort, toPort };
          });
        });

        // 2b. Port roles: a top/bottom port must not serve as both an entry and an exit.
        // When it does, split it into two slots (entries one side, exits the other) so the
        // arrowhead of an incoming edge never sits on the departure point of an outgoing one.
        const PORT_SLOT = 10;
        const fromOffX = {};
        const toOffX = {};
        const fromOffY = {};
        const toOffY = {};
        const splitPortAxis = (nid, sides, fromMap, toMap, axis) => {
          // Keep decision arrowheads/tails on the exact diamond vertices in the initial pass;
          // step 5a separates colliding entries/exits onto free vertices, and 5a2 only offsets if they still collide.
          if (nodeMap[nid] && nodeMap[nid].type === 'decision') return;
          sides.forEach(side => {
            const outs = outEdges[nid].filter(e => edgePorts[e.id] && edgePorts[e.id].fromPort === side);
            const ins = inEdges[nid].filter(e => edgePorts[e.id] && edgePorts[e.id].toPort === side);
            if (!outs.length || !ins.length) return;

            const aligned = (a, b) => Math.abs(rects[a][axis] - rects[b][axis]) < 30;
            const opp = axis === 'cx' ? ['top', 'bottom'] : ['left', 'right'];
            const isStraightOut = outs.some(e => aligned(e.to, nid) && opp.includes(edgePorts[e.id].toPort));
            const isStraightIn = ins.some(e => aligned(e.from, nid) && opp.includes(edgePorts[e.id].fromPort));

            const isDecision = nodeMap[nid] && nodeMap[nid].type === 'decision';
            if ((isStraightOut || isDecision) && !isStraightIn) {
              outs.forEach(e => { fromMap[e.id] = 0; });
              const insMean = ins.reduce((s, e) => s + rects[e.from][axis], 0) / ins.length;
              const slotDir = insMean >= rects[nid][axis] ? 1 : -1;
              ins.forEach(e => { toMap[e.id] = slotDir * PORT_SLOT; });
              return;
            } else if (isStraightIn && !isStraightOut) {
              ins.forEach(e => { toMap[e.id] = 0; });
              const outsMean = outs.reduce((s, e) => s + rects[e.to][axis], 0) / outs.length;
              const slotDir = outsMean >= rects[nid][axis] ? 1 : -1;
              outs.forEach(e => { fromMap[e.id] = slotDir * PORT_SLOT; });
              return;
            }

            const mean = (list, key) => list.reduce((s, e) => s + rects[e[key]][axis], 0) / list.length;
            // Put each group on the side facing where its other ends are, to avoid new crossings
            const insFirst = mean(ins, 'from') <= mean(outs, 'to');
            ins.forEach(e => { toMap[e.id] = insFirst ? -PORT_SLOT : PORT_SLOT; });
            outs.forEach(e => { fromMap[e.id] = insFirst ? PORT_SLOT : -PORT_SLOT; });
          });
        };
        Object.keys(rects).forEach(nid => {
          splitPortAxis(nid, ['top', 'bottom'], fromOffX, toOffX, 'cx');
          splitPortAxis(nid, ['left', 'right'], fromOffY, toOffY, 'cy');
        });

        // Arrow-end rule (references/types/flowchart.md, checklist item 7): short left/right sides MERGE
        // same-role ends (one arrowhead / one fork point); long top/bottom sides SPREAD them 24px apart
        // (5a1, 5a3); entries and exits never share a point on any side (2b, 5a2).
        // 3. Stagger vertical arrival offsets on shared 'left' ports
        const toPortOffsetY = {};
        Object.keys(inEdges).forEach(vId => {
          const leftIns = inEdges[vId].filter(e => edgePorts[e.id] && edgePorts[e.id].toPort === 'left');
          if (leftIns.length > 1) {
            leftIns.sort((a, b) => rects[a.from].cy - rects[b.from].cy);
            // Arrows entering the same port converge on one entry point (single arrowhead)
            leftIns.forEach(e => { toPortOffsetY[e.id] = 0; });
          } else if (leftIns.length === 1) {
            toPortOffsetY[leftIns[0].id] = 0;
          }
        });

        // 4. Stagger vertical channel X for right->left elbow edges sharing the same column gap
        const channelXMap = {};
        const rlElbows = validEdges.filter(e => {
          const p = edgePorts[e.id];
          if (!p || p.fromPort !== 'right' || p.toPort !== 'left') return false;
          const sy = rects[e.from].cy;
          const ey = rects[e.to].cy + (toPortOffsetY[e.id] || 0);
          return Math.abs(sy - ey) >= 6;
        });

        // Group rlElbows by target column bucket
        const gapGroups = {};
        rlElbows.forEach(e => {
          const tx = Math.round(rects[e.to].x / 100) * 100;
          if (!gapGroups[tx]) gapGroups[tx] = [];
          gapGroups[tx].push(e);
        });

        Object.values(gapGroups).forEach(group => {
          if (group.length === 1) {
            const e = group[0];
            const sx = rects[e.from].x + rects[e.from].w;
            const ex = rects[e.to].x;
            channelXMap[e.id] = sx + (ex - sx) * 0.5;
          } else {
            // Sort upward edges by startY ascending, downward edges by startY descending for planar nesting
            const goingUp = group.filter(e => rects[e.to].cy < rects[e.from].cy).sort((a, b) => rects[a.from].cy - rects[b.from].cy);
            const goingDown = group.filter(e => rects[e.to].cy >= rects[e.from].cy).sort((a, b) => rects[b.from].cy - rects[a.from].cy);
            const ordered = [...goingUp, ...goingDown];

            // Unlabelled same-source same-direction fork branches share one channel slot so they form a single fork bus
            const forkCounts = new Map();
            const forkKeyOf = (e) => `${e.from}\0${rects[e.to].cy < rects[e.from].cy ? 'u' : 'd'}`;
            ordered.forEach(e => {
              if (!(e.label || '').trim()) forkCounts.set(forkKeyOf(e), (forkCounts.get(forkKeyOf(e)) || 0) + 1);
            });
            const slots = [];
            const forkSlot = new Map();
            ordered.forEach(e => {
              const fk = forkKeyOf(e);
              if (!(e.label || '').trim() && (forkCounts.get(fk) || 0) >= 2) {
                if (!forkSlot.has(fk)) { const s = []; forkSlot.set(fk, s); slots.push(s); }
                forkSlot.get(fk).push(e);
              } else {
                slots.push([e]);
              }
            });

            slots.forEach((slot, idx) => {
              const sx = rects[slot[0].from].x + rects[slot[0].from].w;
              const ex = Math.min(...slot.map(e => rects[e.to].x));
              const gap = ex - sx;
              const frac = (idx + 1) / (slots.length + 1);
              const cx = sx + Math.max(24, Math.min(gap - 24, gap * frac));
              slot.forEach(e => { channelXMap[e.id] = cx; });
            });
          }
        });

        // 5. First pass: build polylines for all edges
        const edgePolylines = {};
        validEdges.forEach(e => {
          const p = edgePorts[e.id];
          const f = rects[e.from];
          const t = rects[e.to];
          const offsetY = (toPortOffsetY[e.id] || 0) + (toOffY[e.id] || 0);
          const srcOffY = fromOffY[e.id] || 0;
          let points = [];

          if (p.toPort === 'right') {
            // Backward arrow entering the target's right side
            const ex = t.x + t.w, ey = t.cy + offsetY;
            if (p.fromPort === 'left') {
              const sx = f.x, sy = f.cy + srcOffY;
              if (Math.abs(sy - ey) < 6) {
                points = [[sx, sy], [ex, sy]];
              } else {
                const mx = (sx + ex) / 2;
                points = [[sx, sy], [mx, sy], [mx, ey], [ex, ey]];
              }
            } else {
              const sx = f.cx + (fromOffX[e.id] || 0);
              const sy = p.fromPort === 'top' ? f.y : f.y + f.h;
              points = [[sx, sy], [sx, ey], [ex, ey]];
            }
          } else if (p.fromPort === 'left' && p.toPort === 'left') {
            const sx = f.x, sy = f.cy + srcOffY, ex = t.x, ey = t.cy + offsetY;
            let gx = Math.min(sx, ex) - 24;
            for (const pad of [24, 14, 10]) {
              const cand = Math.min(sx, ex) - pad;
              if (cand >= 8 && segmentClear(sx, sy, cand, sy, [e.from, e.to]) && segmentClear(cand, sy, cand, ey, [e.from, e.to]) && segmentClear(cand, ey, ex, ey, [e.from, e.to])) {
                gx = cand;
                break;
              }
            }
            points = [[sx, sy], [gx, sy], [gx, ey], [ex, ey]];
          } else if (p.fromPort === 'left' && (p.toPort === 'top' || p.toPort === 'bottom')) {
            const sx = f.x;
            const sy = f.cy + srcOffY;
            const ex = t.cx + (toOffX[e.id] || 0);
            const ey = (p.toPort === 'top') ? t.y : (t.y + t.h);
            const xExit = sx - 24;
            const sourceAbove = (p.toPort === 'top') ? (sy < ey - 8) : (sy > ey + 8);
            if (sourceAbove && ex < sx - 20 && segmentClear(ex, sy, sx, sy, [e.from, e.to]) && segmentClear(ex, sy, ex, ey, [e.from, e.to])) {
              // Direct one-bend loop-back
              points = [[sx, sy], [ex, sy], [ex, ey]];
            } else {
              // Dedicated Outer Bypass Corridor: route outside node rows
              let bypassY = (p.toPort === 'top') ? Math.min(f.y - 20, t.y - 20) : Math.max(f.y + f.h + 20, t.y + t.h + 20);
              bypassY = Math.max(20, bypassY);
              points = [[sx, sy], [xExit, sy], [xExit, bypassY], [ex, bypassY], [ex, ey]];
            }
          } else if ((p.fromPort === 'top' || p.fromPort === 'bottom') && (p.toPort === 'top' || p.toPort === 'bottom')) {
            const sx = f.cx + (fromOffX[e.id] || 0);
            const sy = (p.fromPort === 'top') ? f.y : (f.y + f.h);
            const ex = t.cx + (toOffX[e.id] || 0);
            const ey = (p.toPort === 'top') ? t.y : (t.y + t.h);
            if (e.to === e.from || t.cx < f.cx - 30) {
              // U-turn: below both nodes, or above them when it leaves and enters through their tops
              const gutterY = p.fromPort === 'top' && p.toPort === 'top' ? Math.min(sy, ey) - 36 : Math.max(sy, ey) + 36;
              points = [[sx, sy], [sx, gutterY], [ex, gutterY], [ex, ey]];
            } else if (Math.abs(sx - ex) < 1) {
              points = [[sx, sy], [ex, ey]];
            } else {
              const midY = sy + (ey - sy) * 0.5;
              points = [[sx, sy], [sx, midY], [ex, midY], [ex, ey]];
            }
          } else if (p.fromPort === 'right' && (p.toPort === 'top' || p.toPort === 'bottom')) {
            // Side exit, then straight into the target's top/bottom: a single bend
            const sx = f.x + f.w;
            const sy = f.cy + srcOffY;
            const ex = t.cx + (toOffX[e.id] || 0);
            const ey = (p.toPort === 'top') ? t.y : (t.y + t.h);
            points = [[sx, sy], [ex, sy], [ex, ey]];
          } else if ((p.fromPort === 'top' || p.fromPort === 'bottom') && p.toPort === 'left') {
            const sx = f.cx + (fromOffX[e.id] || 0);
            const sy = (p.fromPort === 'top') ? f.y : (f.y + f.h);
            const ex = t.x;
            const ey = t.cy + offsetY;
            points = [[sx, sy], [sx, ey], [ex, ey]];
          } else {
            const sx = f.x + f.w;
            const sy = f.cy + srcOffY;
            const ex = t.x;
            const ey = t.cy + offsetY;

            if (Math.abs(sy - ey) < 6) {
              points = [[sx, sy], [ex, sy]];
            } else {
              const midX = channelXMap[e.id] !== undefined ? channelXMap[e.id] : (sx + (ex - sx) * 0.5);
              points = [[sx, sy], [midX, sy], [midX, ey], [ex, ey]];
            }
          }
          edgePolylines[e.id] = points;
        });

        // 4b. U-turn loop-backs that share a gutter and overlap horizontally would draw on top of each other:
        // give each its own gutter row, shortest spans nearest the nodes (further down below the nodes, further up
        // above them).
        [1, -1].forEach(dir => {
          const isU = pts => pts && pts.length === 4 && Math.abs(pts[1][1] - pts[2][1]) < 1 &&
            Math.abs(pts[0][0] - pts[1][0]) < 1 && Math.abs(pts[2][0] - pts[3][0]) < 1 &&
            (pts[1][1] - pts[0][1]) * dir > 0 && (pts[2][1] - pts[3][1]) * dir > 0;
          const us = validEdges.filter(e => isU(edgePolylines[e.id])).map(e => {
            const pts = edgePolylines[e.id];
            return { e, y: pts[1][1], lo: Math.min(pts[0][0], pts[3][0]), hi: Math.max(pts[0][0], pts[3][0]) };
          }).sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo));
          const placed = [];
          us.forEach(u => {
            let k = 0;
            while (placed.some(q => Math.abs(q.y - (u.y + dir * k * 14)) < 2 && q.lo < u.hi && u.lo < q.hi)) k++;
            const pts = edgePolylines[u.e.id];
            if (k) { pts[1][1] += dir * k * 14; pts[2][1] += dir * k * 14; }
            placed.push({ y: pts[1][1], lo: u.lo, hi: u.hi });
          });
        });

        // 5a. Obstructed routes: when the standard route runs through another node, search every
        // exit/entry side pair (L, Z and U shapes) for a route that stays clear, preferring the
        // fewest bends and the least overlap with other arrows. Unobstructed routes are untouched.
        const polyClear = (pts, ids) => {
          for (let i = 0; i < pts.length - 1; i++) {
            if (!segmentClear(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], ids)) return false;
          }
          return true;
        };
        // How a route relates to another arrow: collinear overlap, near-parallel run (<18px) and
        // perpendicular crossings. Arrows that share a node (forks/merges) are exempt by the caller.
        const bboxCache = new WeakMap();
        const bboxOf = (pts) => {
          let b = bboxCache.get(pts);
          if (b) return b;
          b = [Infinity, Infinity, -Infinity, -Infinity];
          for (const [x, y] of pts) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
          bboxCache.set(pts, b);
          return b;
        };
        const NONE = { overlap: 0, near: 0, cross: 0 };
        const relate = (pts, otherPts, skipFirst = false, skipLast = false, skipFirstTrunk = false) => {
          // Every relation needs the two routes within 18px of each other: skip pairs whose boxes are further apart.
          // Only stable (unmutated) polylines are cached; the candidate route is measured fresh.
          const a = bboxOf(otherPts);
          let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
          for (const [x, y] of pts) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
          if (x1 > a[2] + 18 || a[0] > x2 + 18 || y1 > a[3] + 18 || a[1] > y2 + 18) return NONE;
          let overlap = 0, near = 0, cross = 0;
          const lastI = pts.length - 2, lastJ = otherPts.length - 2;
          for (let i = 0; i < pts.length - 1; i++) {
            const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
            const aV = Math.abs(ax - bx) < 1, aH = Math.abs(ay - by) < 1;
            for (let j = 0; j < otherPts.length - 1; j++) {
              if ((skipFirst && i === 0 && j === 0)
                || (skipFirstTrunk && lastI >= 2 && lastJ >= 2 && i === 1 && j === 1)
                || (skipLast && ((i === lastI && j === lastJ) || (lastI >= 2 && lastJ >= 2 && i === lastI - 1 && j === lastJ - 1)))) continue;
              const [cx, cy] = otherPts[j], [dx, dy] = otherPts[j + 1];
              const cV = Math.abs(cx - dx) < 1, cH = Math.abs(cy - dy) < 1;
              if (aV && cV) {
                const run = Math.min(Math.max(ay, by), Math.max(cy, dy)) - Math.max(Math.min(ay, by), Math.min(cy, dy));
                if (run > 1) { const gap = Math.abs(ax - cx); if (gap < 2) overlap += run; else if (gap < 18) near += 1; }
              } else if (aH && cH) {
                const run = Math.min(Math.max(ax, bx), Math.max(cx, dx)) - Math.max(Math.min(ax, bx), Math.min(cx, dx));
                if (run > 1) { const gap = Math.abs(ay - cy); if (gap < 2) overlap += run; else if (gap < 18) near += 1; }
              } else if ((aV && cH) || (aH && cV)) {
                const [vx, vy1, vy2, hy, hx1, hx2] = aV
                  ? [ax, Math.min(ay, by), Math.max(ay, by), cy, Math.min(cx, dx), Math.max(cx, dx)]
                  : [cx, Math.min(cy, dy), Math.max(cy, dy), ay, Math.min(ax, bx), Math.max(ax, bx)];
                if (hx1 + 1 < vx && vx < hx2 - 1 && vy1 + 1 < hy && hy < vy2 - 1) cross += 1;
              }
            }
          }
          return { overlap, near, cross };
        };
        // Cost model: overlap >> near-parallel > crossing (~1.75 bends) > bend > length
        const COST = { overlap: 20000, near: 2500, cross: 1750, bend: 1000, divider: 1500, nearNode: 600, portClash: 2500, sharedBranch: 1200, entryShare: 2600, backwardExit: 3500, upstreamDetour: 4500, sideOvershoot: 1800 };
        const routeDefects = (pts, ids) => {
          // Penalties independent of other arrows: hugging a lane divider, crowding a node
          let d = 0;
          for (let i = 0; i < pts.length - 1; i++) {
            const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
            if (Math.abs(ay - by) < 1 && Math.abs(ax - bx) > 30 && laneDividers.some(y => Math.abs(ay - y) < 8)) d += COST.divider;
            const x1 = Math.min(ax, bx) - 14, x2 = Math.max(ax, bx) + 14, y1 = Math.min(ay, by) - 14, y2 = Math.max(ay, by) + 14;
            let tight = false;
            for (let k = 0; k < rectList.length && !tight; k++) {
              const r = rectList[k][1];
              tight = r.x < x2 && r.x + r.w > x1 && r.y < y2 && r.y + r.h > y1 && !ids.includes(rectList[k][0]);
            }
            if (tight) d += COST.nearNode;
          }
          return d;
        };
        // Entries and exits on any side get separate slots in 2b, so portClashes is 0
        const portClashes = () => 0;
        // Two branches of one decision that carry different labels should leave from different vertices.
        // Not a hard rule (a diamond has only four): it is a cost, so a branch moves to another side only
        // when that side has less overlap/crossing, and shares a vertex when every alternative is worse.
        const sharedBranchVertex = (edge, fp) => {
          const src = nodeMap[edge.from];
          if (!src || src.type !== 'decision') return 0;
          return outEdges[edge.from].filter(o => o !== edge && edgePorts[o.id] && edgePorts[o.id].fromPort === fp
            && (o.label || '').trim().toLowerCase() !== (edge.label || '').trim().toLowerCase()).length;
        };
        const ownBodyClear = (pts, edge) => {
          for (const id of [edge.from, edge.to]) {
            const r = rects[id];
            if (!r) continue;
            const x1 = r.x + 3, x2 = r.x + r.w - 3, y1 = r.y + 3, y2 = r.y + r.h - 3;
            for (let i = 0; i < pts.length - 1; i++) {
              const ax = Math.min(pts[i][0], pts[i + 1][0]), bx = Math.max(pts[i][0], pts[i + 1][0]);
              const ay = Math.min(pts[i][1], pts[i + 1][1]), by = Math.max(pts[i][1], pts[i + 1][1]);
              if (ax < x2 && bx > x1 && ay < y2 && by > y1) return false;
            }
          }
          return true;
        };
        const routeCost = (pts, edge, others, fp, tp, limit = Infinity) => {
          const ids = [edge.from, edge.to];
          let len = 0;
          for (let i = 0; i < pts.length - 1; i++) len += Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1]);
          if ((pts.length - 2) * COST.bend + len >= limit) return Infinity;   // cannot beat the best so far
          if (!polyClear(pts, ids)) return Infinity;
          // A route must not run back through the body of its own source or target node
          if (!ownBodyClear(pts, edge)) return Infinity;
          // Every penalty is non-negative, so once the running cost reaches `limit` this route cannot win: stop
          const fixed = (pts.length - 2) * COST.bend + len;
          let defect = portClashes(edge, fp, tp) * COST.portClash + sharedBranchVertex(edge, fp) * COST.sharedBranch;
          const f = rects[edge.from], t = rects[edge.to];
          if (t.cx >= f.cx - 30) {
            if (nodeMap[edge.from] && nodeMap[edge.from].type === 'decision' && fp === 'left') {
              defect += COST.backwardExit;
            }
            let minX = Infinity;
            for (let i = 0; i < pts.length; i++) if (pts[i][0] < minX) minX = pts[i][0];
            const upLimit = Math.min(f.x, t.x) - 16;
            if (minX < upLimit) defect += COST.upstreamDetour + (upLimit - minX) * 4;
          }
          if (fp !== tp) {
            let minY = Infinity, maxY = -Infinity;
            for (let i = 0; i < pts.length; i++) {
              if (pts[i][1] < minY) minY = pts[i][1];
              if (pts[i][1] > maxY) maxY = pts[i][1];
            }
            const loY = Math.min(f.y, t.y) - 16, hiY = Math.max(f.y + f.h, t.y + t.h) + 16;
            const overY = Math.max(0, loY - minY) + Math.max(0, maxY - hiY);
            if (overY > 0) defect += COST.sideOvershoot + overY * 4;
          }
          if (fixed + defect >= limit) return Infinity;
          for (let k = 0; k < others.length; k++) {
            const o = others[k], op = edgePorts[o.id];
            const incident = o.from === edge.from || o.to === edge.to || o.from === edge.to || o.to === edge.from;
            const skipFirst = o.from === edge.from && op && op.fromPort === fp;
            const skipLast = o.to === edge.to && op && op.toPort === tp;
            const skipFirstTrunk = skipFirst && !(edge.label || '').trim() && !(o.label || '').trim();
            const r = relate(pts, edgePolylines[o.id], skipFirst, skipLast, skipFirstTrunk);
            defect += (r.overlap > 0 ? COST.overlap + r.overlap : 0) + (incident ? 0 : r.near * COST.near) + r.cross * COST.cross;
            if (fixed + defect >= limit) return Infinity;
          }
          defect += routeDefects(pts, ids);
          if (fixed + defect >= limit) return Infinity;
          return { cost: fixed + defect, defect };
        };
        const anchor = (r, side) => side === 'top' ? [r.cx, r.y] : side === 'bottom' ? [r.cx, r.y + r.h]
          : side === 'left' ? [r.x, r.cy] : [r.x + r.w, r.cy];
        // Whole-diagram bounds, for corridor routes that run around everything
        const bounds = Object.values(rects).reduce((b, r) => ({
          minX: Math.min(b.minX, r.x), maxX: Math.max(b.maxX, r.x + r.w),
          minY: Math.min(b.minY, r.y), maxY: Math.max(b.maxY, r.y + r.h)
        }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
        // Gap centers (+/-22px) between node bands and node clearance edges so tight corridors are never skipped
        const buildCorridors = (loKey, sizeKey, minBound, maxBound) => {
          const ivs = rectList.map(([, r]) => [r[loKey], r[loKey] + r[sizeKey]]).sort((a, b) => a[0] - b[0]);
          const seen = new Set();
          const out = [];
          const push = (v) => {
            const q = Math.round(v / 8);
            if (seen.has(q)) return;
            seen.add(q);
            out.push(v);
          };
          let hi = -Infinity;
          for (const [a, b] of ivs) {
            if (a > hi + 28 && hi > -Infinity) {
              const mid = (hi + a) / 2;
              push(mid); push(mid - 22); push(mid + 22);
            }
            if (b > hi) hi = b;
          }
          for (let k = 0; k < rectList.length; k++) {
            const r = rectList[k][1];
            push(r[loKey] - 16);
            push(r[loKey] + r[sizeKey] + 16);
          }
          push(minBound - 24);
          push(maxBound + 24);
          return out;
        };
        const corridorXs = buildCorridors('x', 'w', bounds.minX, bounds.maxX);
        const corridorYs = buildCorridors('y', 'h', bounds.minY, bounds.maxY);
        const altRoutes = (f, t, deep) => {
          const out = [];
          const SIDES = ['top', 'bottom', 'left', 'right'];
          const horiz = s => s === 'left' || s === 'right';
          SIDES.forEach(fp => SIDES.forEach(tp => {
            const [sx, sy] = anchor(f, fp), [ex, ey] = anchor(t, tp);
            const add = (pts, dev = 0) => out.push({ fp, tp, pts, dev });
            if (horiz(fp) && horiz(tp)) {
              if (fp === tp) return;
              const dirOk = fp === 'right' ? ex > sx + 28 : ex < sx - 28;
              if (!dirOk) return;
              if (Math.abs(sy - ey) < 6) { add([[sx, sy], [ex, sy]]); return; }
              const lo = Math.min(sx, ex) + 14, hi = Math.max(sx, ex) - 14, mid = (sx + ex) / 2;
              let hasMid = false;
              for (let x = lo; x <= hi; x += 16) {
                if (Math.abs(x - mid) < 4) hasMid = true;
                add([[sx, sy], [x, sy], [x, ey], [ex, ey]], Math.abs(x - mid));
              }
              if (!hasMid && lo <= mid && mid <= hi) add([[sx, sy], [mid, sy], [mid, ey], [ex, ey]], 0);
            } else if (!horiz(fp) && !horiz(tp)) {
              if (fp !== tp) {
                const dirOk = fp === 'bottom' ? ey > sy + 28 : ey < sy - 28;
                if (!dirOk) return;
                if (Math.abs(sx - ex) < 1) { add([[sx, sy], [ex, ey]]); return; }
                const lo = Math.min(sy, ey) + 14, hi = Math.max(sy, ey) - 14, mid = (sy + ey) / 2;
                let hasMid = false;
                for (let y = lo; y <= hi; y += 16) {
                  if (Math.abs(y - mid) < 4) hasMid = true;
                  add([[sx, sy], [sx, y], [ex, y], [ex, ey]], Math.abs(y - mid));
                }
                if (!hasMid && lo <= mid && mid <= hi) add([[sx, sy], [sx, mid], [ex, mid], [ex, ey]], 0);
              } else {
                const seenG = new Set();
                const tryU = g => {
                  if (fp === 'top' ? g > Math.min(sy, ey) - 12 : g < Math.max(sy, ey) + 12) return;
                  const q = Math.round(g / 8);
                  if (seenG.has(q)) return;
                  seenG.add(q);
                  add([[sx, sy], [sx, g], [ex, g], [ex, ey]]);
                };
                [28, 36, 48, 72].forEach(d => tryU(fp === 'top' ? Math.max(8, Math.min(sy, ey) - d) : Math.max(sy, ey) + d));
                if (deep) corridorYs.forEach(tryU);
              }
            } else if (horiz(fp)) {
              // horizontal exit, vertical entry: one bend
              if (!(fp === 'right' ? ex <= sx + 20 : ex >= sx - 20) && !(tp === 'top' ? ey <= sy + 8 : ey >= sy - 8)) {
                add([[sx, sy], [ex, sy], [ex, ey]]);
              }
            } else {
              // vertical exit, horizontal entry: one bend
              if (!(fp === 'top' ? sy <= ey + 8 : sy >= ey - 8) && !(tp === 'left' ? ex <= sx + 20 : ex >= sx - 20)) {
                add([[sx, sy], [sx, ey], [ex, ey]]);
              }
            }
            if (deep && horiz(fp) !== horiz(tp)) {
              // Three bends through a corridor: leave, run along a corridor, drop/rise, then enter
              const STEP = 64;
              if (!horiz(fp)) {
                // vertical exit -> corridor above/below -> sideways to x -> vertical -> horizontal entry
                [16, 20, 36, 56].forEach(d => {
                  const g = fp === 'top' ? sy - d : sy + d;
                  const seenX = new Set();
                  const tryX = x => {
                    const q = Math.round(x / 8);
                    if (seenX.has(q)) return;
                    seenX.add(q);
                    if (tp === 'left' ? x > ex - 14 : x < ex + 14) return;
                    if (Math.abs(x - sx) < 10 || Math.abs(ey - g) < 10) return;
                    add([[sx, sy], [sx, g], [x, g], [x, ey], [ex, ey]], 0);
                  };
                  corridorXs.forEach(tryX);
                  const xLo = Math.min(sx, ex) - 64, xHi = Math.max(sx, ex) + 64;
                  for (let x = xLo; x <= xHi; x += STEP) tryX(x);
                });
              } else {
                // horizontal exit -> out to x -> vertical to corridor g -> across -> vertical entry
                [16, 20, 36, 56].forEach(d => {
                  const x = fp === 'right' ? sx + d : sx - d;
                  const seenG = new Set();
                  const tryG = g => {
                    const q = Math.round(g / 8);
                    if (seenG.has(q)) return;
                    seenG.add(q);
                    if (tp === 'top' ? g > ey - 14 : g < ey + 14) return;
                    if (Math.abs(g - sy) < 10 || Math.abs(ex - x) < 10) return;
                    add([[sx, sy], [x, sy], [x, g], [ex, g], [ex, ey]], 0);
                  };
                  corridorYs.forEach(tryG);
                  const gLo = Math.min(sy, ey) - 64, gHi = Math.max(sy, ey) + 64;
                  for (let g = gLo; g <= gHi; g += STEP) tryG(g);
                });
              }
            }
          }));
          return out;
        };
        // Longest arrows first: they are the most constrained, shorter ones then route around them.
        // Exclude currently obstructed placeholder polylines from `others` so clean edges do not swerve
        // around lines that cut through nodes and are about to be rerouted.
        const edgeClear = {};
        validEdges.forEach(o => {
          const pts = edgePolylines[o.id];
          edgeClear[o.id] = Boolean(pts && polyClear(pts, [o.from, o.to]));
        });
        const manhattan = e => Math.abs(rects[e.from].cx - rects[e.to].cx) + Math.abs(rects[e.from].cy - rects[e.to].cy);
        [...validEdges].sort((a2, b2) => manhattan(b2) - manhattan(a2)).forEach(e => {
          if (e.to === e.from) return;
          const cur = edgePolylines[e.id];
          if (!cur) return;
          const others = validEdges.filter(o => o !== e && edgePolylines[o.id] && edgeClear[o.id]);
          // A decision branch that leaves from the top/bottom vertex an incoming arrow already takes gets pushed
          // off the vertex onto the diamond's slanted edge (2b/5a2). That is a cost, not a ban: the branch moves
          // to a free vertex only when that route is clean enough to beat it (a detour that adds a crossing does not).
          const srcIsDecision = nodeMap[e.from] && nodeMap[e.from].type === 'decision';
          const dstIsDecision = nodeMap[e.to] && nodeMap[e.to].type === 'decision';
          const entryVertex = s => srcIsDecision && (s === 'top' || s === 'bottom')
            && (inEdges[e.from] || []).some(o => edgePorts[o.id] && edgePorts[o.id].toPort === s);
          const branchVertex = s => dstIsDecision && (s === 'top' || s === 'bottom' || s === 'right')
            && (outEdges[e.to] || []).some(o => edgePorts[o.id] && edgePorts[o.id].fromPort === s);
          const entryShare = (fp, tp) => (entryVertex(fp) ? COST.entryShare : 0) + (branchVertex(tp) ? COST.entryShare : 0);
          const base = routeCost(cur, e, others, edgePorts[e.id].fromPort, edgePorts[e.id].toPort);
          const baseEntryShare = entryShare(edgePorts[e.id].fromPort, edgePorts[e.id].toPort);
          // Already clean (clear of nodes, no overlap/crossing/crowding, on its own vertex): keep it
          if (base !== Infinity && base.defect === 0 && baseEntryShare === 0) return;
          const baseCost = base === Infinity ? Infinity : base.cost + baseEntryShare;
          let best = null;
          // 3-bend corridor routes are only worth searching when the standard route is in real trouble
          const deep = base === Infinity || base.defect + baseEntryShare >= COST.cross;
          altRoutes(rects[e.from], rects[e.to], deep).forEach(c => {
            const r = routeCost(c.pts, e, others, c.fp, c.tp, best ? best.cost : baseCost - 250);
            if (r === Infinity) return;
            // Changing sides is a bigger visual change than sliding a channel, so it must earn it
            const sideChange = (c.fp !== edgePorts[e.id].fromPort || c.tp !== edgePorts[e.id].toPort) ? 600 : 0;
            const cost = r.cost + c.dev * 0.3 + sideChange + entryShare(c.fp, c.tp);
            if (!best || cost < best.cost) best = { cost, c };
          });
          // Hysteresis: only switch for a clear win, so near-ties keep the standard route
          if (best && best.cost < baseCost - 250) {
            edgePolylines[e.id] = best.c.pts;
            edgePorts[e.id] = { fromPort: best.c.fp, toPort: best.c.tp };
            edgeClear[e.id] = true;
          }
        });

        // 5a1. Spread arrows that share one contact point on a top/bottom side: several entries from
        // different sources, or several exits to different targets, would otherwise merge into a single
        // line. They get 24px apart (a straight, aligned arrow keeps the centre and the others move away).
        const SPREAD = 24;
        // Order of arrow ends along a top/bottom side: by where their other end lies. On a tie (targets in one
        // column), the arrow whose vertical run is longer goes on the inside of the turn, so the shorter one,
        // turning first, never has its horizontal run cut by the longer one's vertical.
        const farOrder = (far1, far2, cx, pts1, a1, b1, pts2, a2, b2) => {
          const run1 = Math.abs(pts1[b1][1] - pts1[a1][1]), run2 = Math.abs(pts2[b2][1] - pts2[a2][1]);
          // Both heading the same way with different-depth turns: the deeper run goes on the inside, so the
          // shallower one's horizontal never crosses it (ordering by target x alone made them cross)
          if (Math.abs(run1 - run2) >= 1 && (far1 > cx) === (far2 > cx) && pts1.length === 3 && pts2.length === 3) {
            return far1 > cx ? run2 - run1 : run1 - run2;
          }
          if (Math.abs(far1 - far2) >= 1) return far1 - far2;
          return far1 > cx ? run2 - run1 : run1 - run2;
        };
        Object.keys(rects).forEach(nid => {
          const r = rects[nid];
          [['top', r.y], ['bottom', r.y + r.h]].forEach(([side, edgeY]) => {
            ['out', 'in'].forEach(role => {
              // A decision's outgoing branches each get their own vertex in step 2; incoming fan-in arrows still merge onto one shared arrowhead
              if (role === 'out' && nodeMap[nid] && nodeMap[nid].type === 'decision') return;
              const ends = [];
              validEdges.forEach(e => {
                const pts = edgePolylines[e.id];
                if (!pts) return;
                const n = pts.length;
                if (role === 'out' && e.from === nid && Math.abs(pts[0][1] - edgeY) < 1 && Math.abs(pts[0][0] - pts[1][0]) < 1)
                  ends.push({ e, a: 0, b: 1, x: pts[0][0], fixed: n < 3, peer: e.to, far: pts[n - 1][0] });
                if (role === 'in' && e.to === nid && Math.abs(pts[n - 1][1] - edgeY) < 1 && Math.abs(pts[n - 1][0] - pts[n - 2][0]) < 1)
                  ends.push({ e, a: n - 1, b: n - 2, x: pts[n - 1][0], fixed: n < 3, peer: e.from, far: pts[0][0] });
              });
              ends.sort((p1, p2) => p1.x - p2.x);
              const clusterGap = role === 'in' ? SPREAD : 10;
              const hasOutOnSide = role === 'in' && validEdges.some(o => {
                const op = edgePolylines[o.id];
                return op && o.from === nid && Math.abs(op[0][1] - edgeY) < 1 && Math.abs(op[0][0] - op[1][0]) < 1;
              });
              let i = 0;
              while (i < ends.length) {
                let j = i + 1;
                while (j < ends.length && ends[j].x - ends[j - 1].x < clusterGap) j++;
                const cluster = ends.slice(i, j);
                i = j;
                if (cluster.length < 2 || new Set(cluster.map(c => c.peer)).size < 2) continue;
                const fixed = cluster.filter(c => c.fixed), movable = cluster.filter(c => !c.fixed).sort((p1, p2) =>
                  farOrder(p1.far, p2.far, r.cx, edgePolylines[p1.e.id], p1.a, p1.b, edgePolylines[p2.e.id], p2.a, p2.b));
                // Nested U-turn loop-backs (each deeper than the last): the one whose source is furthest away
                // sits in the deepest gutter, so it must land first/left or its rising leg cuts the shallower loop
                if (movable.length > 1 && movable.every(c => edgePolylines[c.e.id].length === 4)) movable.reverse();
                if (!movable.length) continue;
                const base0 = cluster.reduce((s2, c) => s2 + c.x, 0) / cluster.length;
                const shiftEnd = (c, nx) => { edgePolylines[c.e.id][c.a][0] = nx; edgePolylines[c.e.id][c.b][0] = nx; };
                if (role === 'in') {
                  // Fan-in: arrows entering one side of one step share a single trunk (and one arrowhead) and
                  // join where their runs meet it, like a merge on a hand-drawn flowchart. Spreading them 24px
                  // apart drew a doubled line. A straight arrow keeps its line; otherwise centre when the side has no exits.
                  const lo = r.x + 14, hi = r.x + r.w - 14;
                  const cands = fixed.length ? [fixed[0].x]
                    : !hasOutOnSide ? [r.cx, ...cluster.map(c => c.x), base0]
                    : [...cluster.map(c => c.x), base0];
                  const canJoinAt = (jx) => jx >= lo && jx <= hi && movable.every(c => {
                    const pts = edgePolylines[c.e.id];
                    const ids = [c.e.from, c.e.to];
                    return segmentClear(jx, pts[c.a][1], jx, pts[c.b][1], ids)
                      && segmentClear(jx, pts[c.b][1], pts[c.b - 1][0], pts[c.b - 1][1], ids);
                  });
                  const jx = cands.find(canJoinAt);
                  if (jx !== undefined) movable.forEach(c => shiftEnd(c, jx));
                } else if (fixed.length) {
                  const fx = fixed[0].x;
                  // Each moved end slides toward the side its other end lies on, so it never has to cross
                  // the straight arrow (movable is sorted by `far`, so the nearest-to-centre ends sit closest)
                  const sideCount = { '-1': 0, '1': 0 };
                  const ordered = [...movable].sort((p1, p2) => Math.abs(p1.far - fx) - Math.abs(p2.far - fx));
                  ordered.forEach(c => {
                    const dir = c.far < fx - 1 ? -1 : c.far > fx + 1 ? 1 : (sideCount['1'] <= sideCount['-1'] ? 1 : -1);
                    sideCount[dir] += 1;
                    shiftEnd(c, fx + dir * SPREAD * sideCount[dir]);
                  });
                } else {
                  const m = movable.length;
                  movable.forEach((c, k) => shiftEnd(c, base0 + (k - (m - 1) / 2) * SPREAD));
                }
              }
            });
          });
        });

        // 5a2. Port separation: where an arrow enters and another leaves the same side of a node,
        // keep their contact points at least 16px apart so an arrowhead never sits on a departure.
        const SEP = 16, SHIFT = 9;
        Object.keys(rects).forEach(nid => {
          const r = rects[nid];
          [['top', 0, r.y], ['bottom', 0, r.y + r.h], ['left', 1, r.x], ['right', 1, r.x + r.w]].forEach(([side, ai, edgeCoord]) => {
            const fi = 1 - ai; // ai: coordinate that slides along the side, fi: the fixed one
            const ends = [];
            validEdges.forEach(e => {
              const pts = edgePolylines[e.id];
              if (!pts || pts.length < 3) return;       // straight lines stay aligned
              const n = pts.length;
              if (e.from === nid && Math.abs(pts[0][fi] - edgeCoord) < 1 && Math.abs(pts[0][ai] - pts[1][ai]) < 1) ends.push({ e, role: 'out', a: 0, b: 1, other: pts[n - 1][ai] });
              if (e.to === nid && Math.abs(pts[n - 1][fi] - edgeCoord) < 1 && Math.abs(pts[n - 1][ai] - pts[n - 2][ai]) < 1) ends.push({ e, role: 'in', a: n - 1, b: n - 2, other: pts[0][ai] });
            });
            const outs = ends.filter(x => x.role === 'out'), ins = ends.filter(x => x.role === 'in');
            if (!outs.length || !ins.length) return;
            const at = x => edgePolylines[x.e.id][x.a][ai];
            const minGap = Math.min(...ins.flatMap(i => outs.map(o => Math.abs(at(i) - at(o)))));
            if (minGap >= SEP) return;
            const mean = l => l.reduce((s2, x) => s2 + x.other, 0) / l.length;
            const insLow = mean(ins) <= mean(outs);
            const shift = (x, d) => { edgePolylines[x.e.id][x.a][ai] += d; edgePolylines[x.e.id][x.b][ai] += d; };
            if (nodeMap[nid] && nodeMap[nid].type === 'decision') {
              ins.forEach(x => shift(x, insLow ? -SEP : SEP));
            } else {
              ins.forEach(x => shift(x, insLow ? -SHIFT : SHIFT));
              outs.forEach(x => shift(x, insLow ? SHIFT : -SHIFT));
            }
          });
        });

        // 5a3. Arrowhead clearance on top/bottom sides. Every contact point (entry or exit) on one side
        // must be at least CLEAR px from the next one. 5a1/5a2 leave gaps they cannot see: a straight,
        // aligned arrow keeps the side's centre and was exempt, so a neighbouring arrowhead could land
        // 3px from it. Straight arrows stay where they are; the others slide to the side their other end
        // lies on. Edges that merge on purpose (same role, same other node, same spot) move together.
        const CLEAR = 24;
        Object.keys(rects).forEach(nid => {
          const r = rects[nid];
          [['top', r.y], ['bottom', r.y + r.h]].forEach(([side, edgeY]) => {
            const units = new Map();
            validEdges.forEach(e => {
              const pts = edgePolylines[e.id];
              if (!pts) return;
              const n = pts.length;
              const add = (role, a, b, peer, far) => {
                const mergeIn = role === 'in';   // fan-in: one trunk per side (5a1)
                const key = role + '|' + (mergeIn ? '*' : peer) + '|' + Math.round(pts[a][0]);
                if (!units.has(key)) units.set(key, { x: pts[a][0], fixed: false, far, ends: [] });
                const u = units.get(key);
                u.ends.push({ pts, a, b });
                // Straight arrows and decision outgoing branches stay at their vertex (never slide onto a slanted side)
                if (n < 3 || (role === 'out' && nodeMap[nid] && nodeMap[nid].type === 'decision')) u.fixed = true;
              };
              if (e.from === nid && Math.abs(pts[0][1] - edgeY) < 1 && Math.abs(pts[0][0] - pts[1][0]) < 1) add('out', 0, 1, e.to, pts[n - 1][0]);
              if (e.to === nid && Math.abs(pts[n - 1][1] - edgeY) < 1 && Math.abs(pts[n - 1][0] - pts[n - 2][0]) < 1) add('in', n - 1, n - 2, e.from, pts[0][0]);
            });
            const sorted = [...units.values()].sort((u1, u2) => u1.x - u2.x);
            const lo = r.x + 14, hi = r.x + r.w - 14;
            const place = (u, nx) => {
              const x = Math.max(lo, Math.min(hi, nx));
              u.ends.forEach(en => { en.pts[en.a][0] = x; en.pts[en.b][0] = x; });
              u.x = x;
            };
            let i = 0;
            while (i < sorted.length) {
              let j = i + 1;
              while (j < sorted.length && sorted[j].x - sorted[j - 1].x < CLEAR - 0.5) j++;
              const cluster = sorted.slice(i, j);
              i = j;
              const fixed = cluster.filter(u => u.fixed);
              const movable = cluster.filter(u => !u.fixed).sort((u1, u2) => farOrder(u1.far, u2.far, r.cx,
                u1.ends[0].pts, u1.ends[0].a, u1.ends[0].b, u2.ends[0].pts, u2.ends[0].a, u2.ends[0].b));
              if (cluster.length < 2 || !movable.length) continue;
              // Nested U-turn loop-backs: the arrow with the furthest source runs in the deepest gutter, so it
              // must take the slot nearest the fixed/centre line (or the outermost on the other side), never
              // the reverse, or its rising leg cuts through the shallower loop
              const nested = movable.length > 1 && movable.every(u => u.ends.every(en => en.pts.length === 4));
              if (nested) movable.reverse();
              if (!fixed.length) {
                const mean = cluster.reduce((s2, u) => s2 + u.x, 0) / cluster.length;
                movable.forEach((u, k) => place(u, mean + (k - (movable.length - 1) / 2) * CLEAR));
              } else {
                const fMin = Math.min(...fixed.map(u => u.x)), fMax = Math.max(...fixed.map(u => u.x));
                const anchor = (fMin + fMax) / 2;
                const left = movable.filter(u => u.far < anchor - 1).sort((u1, u2) => nested ? u1.far - u2.far : u2.far - u1.far);
                const right = movable.filter(u => !(u.far < anchor - 1));
                left.forEach((u, k) => place(u, fMin - CLEAR * (k + 1)));
                right.forEach((u, k) => place(u, fMax + CLEAR * (k + 1)));
              }
            }
          });
        });

        // 5a4. Arrows into one side of one step that run side by side a few px apart (e.g. a Z-shaped channel
        // beside another arrow's straight leg) are one fan-in: snap the movable run onto the other so they share
        // a single trunk and join, instead of reading as a doubled line. Port-attached first/last legs stay put.
        {
          const NEAR = 18;
          const runs = [];
          validEdges.forEach(e => {
            const pts = edgePolylines[e.id], p = edgePorts[e.id];
            if (!pts || pts.length < 3 || !p) return;
            for (let i = 0; i < pts.length - 2; i++) {          // the last leg (into the target) is shared already
              const a = pts[i], b = pts[i + 1];
              const k = Math.abs(a[0] - b[0]) < 1 ? 0 : Math.abs(a[1] - b[1]) < 1 ? 1 : -1;
              if (k < 0) continue;
              runs.push({ e, i, k, pos: a[k], lo: Math.min(a[1 - k], b[1 - k]), hi: Math.max(a[1 - k], b[1 - k]), first: i === 0, to: p.toPort });
            }
          });
          runs.forEach(m => {
            if (m.first) return;                                  // attached to its source: it is the one others join
            const pts = edgePolylines[m.e.id];
            const t = runs.find(o => o.e.to === m.e.to && o.e.id !== m.e.id && o.to === m.to && o.k === m.k &&
              Math.abs(o.pos - m.pos) >= 1 && Math.abs(o.pos - m.pos) < NEAR && Math.min(o.hi, m.hi) - Math.max(o.lo, m.lo) > 24 &&
              (o.first || o.e.id < m.e.id));
            if (!t) return;
            const k = m.k, old = m.pos, ids = [m.e.from, m.e.to];
            pts[m.i][k] = pts[m.i + 1][k] = t.pos;
            // the legs either side must stay clear of other steps and keep their direction
            const legOk = (j) => segmentClear(pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1], ids);
            const ok = legOk(m.i - 1) && legOk(m.i) && legOk(m.i + 1) &&
              Math.sign(t.pos - pts[m.i - 1][k]) === Math.sign(old - pts[m.i - 1][k]) &&
              Math.sign(pts[m.i + 2][k] - t.pos) === Math.sign(pts[m.i + 2][k] - old);
            if (!ok) pts[m.i][k] = pts[m.i + 1][k] = old;
          });
        }

        // 5a5. Two arrows into one step that leave facing each other along one line (a bottom exit and a top
        // exit of steps stacked in a column, both turning into the same run) read as one straight line between
        // the two sources. Slide the later exit sideways, toward the run it joins, so it meets the other
        // arrow's run at a clear T.
        {
          const SLIDE = 24;
          const ends = [];
          validEdges.forEach(e => {
            const pts = edgePolylines[e.id];
            if (!pts || pts.length < 3) return;
            [0, 1].forEach(k => {
              if (Math.abs(pts[0][k] - pts[1][k]) < 1 && Math.abs(pts[1][1 - k] - pts[0][1 - k]) > 1) ends.push({ e, pts, k });
            });
          });
          ends.forEach((b, bi) => ends.slice(0, bi).forEach(a => {
            if (a.k !== b.k || a.e.to !== b.e.to || a.e.from === b.e.from) return;
            const k = a.k, m = 1 - k;
            if (Math.abs(a.pts[0][k] - b.pts[0][k]) >= 1) return;
            const da = Math.sign(a.pts[1][m] - a.pts[0][m]), db = Math.sign(b.pts[1][m] - b.pts[0][m]);
            if (da * db >= 0) return;                              // not facing
            const gap = da > 0 ? b.pts[1][m] - a.pts[1][m] : a.pts[1][m] - b.pts[1][m];
            if (gap < 0 || gap > 40 || Math.abs(a.pts[0][m] - b.pts[0][m]) >= 120) return;  // far apart, or overlapping (not this case)
            const dir = Math.sign(b.pts[2][k] - b.pts[1][k]);
            const src = rects[b.e.from], nx = b.pts[0][k] + dir * SLIDE;
            const lo = (k === 0 ? src.x : src.y) + 14, hi = (k === 0 ? src.x + src.w : src.y + src.h) - 14;
            if (!dir || Math.abs(b.pts[2][k] - b.pts[1][k]) < SLIDE + 12 || nx < lo || nx > hi) return;
            b.pts[0][k] = b.pts[1][k] = nx;
          }));
        }

        // 5a6. Fork bends: arrows that leave one point sideways and turn at different x (a Z next to a corridor route)
        // snap to one shared turn, so the fork bends in one place. Skipped when both turn the same way and one is
        // labelled (they would share a trunk and the label could not tell them apart), or when the snap would
        // reverse a leg or cross a step.
        {
          const forks = {};
          validEdges.forEach(e => {
            const pts = edgePolylines[e.id];
            if (pts && pts.length >= 4 && Math.abs(pts[0][1] - pts[1][1]) < 1 && Math.abs(pts[1][0] - pts[2][0]) < 1 && Math.abs(pts[1][0] - pts[0][0]) > 1) {
              (forks[`${e.from}|${pts[0][0]}|${pts[0][1]}`] = forks[`${e.from}|${pts[0][0]}|${pts[0][1]}`] || []).push(e);
            }
          });
          Object.values(forks).forEach(group => {
            if (group.length < 2) return;
            group.sort((a, b) => edgePolylines[a.id].length - edgePolylines[b.id].length || (a.id < b.id ? -1 : 1));
            const lead = edgePolylines[group[0].id], x = lead[1][0], dirY = Math.sign(lead[2][1] - lead[1][1]);
            group.slice(1).forEach(e => {
              const pts = edgePolylines[e.id], old = pts[1][0];
              if (Math.abs(old - x) < 1) return;
              const sameWay = Math.sign(pts[2][1] - pts[1][1]) === dirY;
              if (sameWay && ((e.label || '').trim() || (group[0].label || '').trim())) return;
              if (Math.sign(x - pts[0][0]) !== Math.sign(old - pts[0][0])) return;
              if (Math.sign(pts[3][0] - x) !== Math.sign(pts[3][0] - old)) return;
              pts[1][0] = pts[2][0] = x;
              if (!polyClear(pts, [e.from, e.to])) pts[1][0] = pts[2][0] = old;
            });
          });
        }

        // 5b. De-overlap: unrelated edges must not share a collinear stretch. Spread interior
        // segments (never the port-attached first/last ones) onto parallel tracks.
        // Edges sharing a source or a target may still merge/fork on purpose.
        const TRACK_GAP = 14;
        ['v', 'h'].forEach(orient => {
          const segs = [];
          validEdges.forEach(e => {
            const pts = edgePolylines[e.id];
            if (!pts) return;
            for (let i = 1; i < pts.length - 2; i++) {
              const a = pts[i], b = pts[i + 1];
              const isV = Math.abs(a[0] - b[0]) < 1;
              const isH = Math.abs(a[1] - b[1]) < 1;
              if (orient === 'v' ? !isV : !isH) continue;
              const k = orient === 'v' ? 0 : 1; // fixed axis
              const m = 1 - k;                  // running axis
              segs.push({ e, i, pos: a[k], lo: Math.min(a[m], b[m]), hi: Math.max(a[m], b[m]) });
            }
          });
          const parent = segs.map((_, i) => i);
          const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
          for (let a = 0; a < segs.length; a++) {
            for (let b = a + 1; b < segs.length; b++) {
              const A = segs[a], B = segs[b];
              if (A.e.id === B.e.id || A.e.from === B.e.from || A.e.to === B.e.to) continue;
              if (Math.abs(A.pos - B.pos) >= 1) continue;
              if (Math.min(A.hi, B.hi) - Math.max(A.lo, B.lo) <= 2) continue;
              parent[find(a)] = find(b);
            }
          }
          const clusters = {};
          segs.forEach((s, idx) => { (clusters[find(idx)] = clusters[find(idx)] || []).push(s); });
          Object.values(clusters).forEach(cl => {
            if (cl.length < 2) return;
            // Order tracks by where each edge heads next so nesting stays planar
            cl.sort((p, q) => (orient === 'v' ? rects[p.e.to].cx - rects[q.e.to].cx : rects[p.e.to].cy - rects[q.e.to].cy));
            const k = orient === 'v' ? 0 : 1;
            const applyGap = (gap) => {
              const saved = cl.map(s => [edgePolylines[s.e.id][s.i][k], edgePolylines[s.e.id][s.i + 1][k]]);
              cl.forEach((s, idx) => {
                const shift = (idx - (cl.length - 1) / 2) * gap;
                const pts = edgePolylines[s.e.id];
                pts[s.i][k] += shift;
                pts[s.i + 1][k] += shift;
              });
              if (!cl.every(s => polyClear(edgePolylines[s.e.id], [s.e.from, s.e.to]))) {
                cl.forEach((s, idx) => {
                  const pts = edgePolylines[s.e.id];
                  pts[s.i][k] = saved[idx][0];
                  pts[s.i + 1][k] = saved[idx][1];
                });
                return false;
              }
              return true;
            };
            if (!applyGap(TRACK_GAP)) {
              cl.forEach((s, idx) => {
                const shift = (idx - (cl.length - 1) / 2) * 8;
                const pts = edgePolylines[s.e.id];
                pts[s.i][k] += shift;
                pts[s.i + 1][k] += shift;
              });
            }
          });
        });

        // 5b2. Decision parallel fan spacing: when multiple arrows leave or enter the same side of a
        // decision node and share parallel interior segments within 20px, spread those interior legs
        // apart by 20px (after clearing the vertex stub) so multi-branch fans read cleanly.
        const DECISION_TRACK_GAP = 20;
        ['v', 'h'].forEach(orient => {
          const k = orient === 'v' ? 0 : 1; // fixed axis
          const m = 1 - k;                  // running axis
          const segs = [];
          validEdges.forEach(e => {
            const pts = edgePolylines[e.id];
            const p = edgePorts[e.id];
            if (!pts || !p) return;
            const srcDec = nodeMap[e.from] && nodeMap[e.from].type === 'decision';
            const dstDec = nodeMap[e.to] && nodeMap[e.to].type === 'decision';
            if (!srcDec && !dstDec) return;
            for (let i = 1; i < pts.length - 2; i++) {
              const a = pts[i], b = pts[i + 1];
              const isV = Math.abs(a[0] - b[0]) < 1;
              const isH = Math.abs(a[1] - b[1]) < 1;
              if (orient === 'v' ? !isV : !isH) continue;
              segs.push({ e, p, i, pos: a[k], lo: Math.min(a[m], b[m]), hi: Math.max(a[m], b[m]), srcDec, dstDec });
            }
          });
          const sameDecisionSide = (A, B) =>
            (A.srcDec && A.e.from === B.e.from && A.p.fromPort === B.p.fromPort) ||
            (A.dstDec && A.e.to === B.e.to && A.p.toPort === B.p.toPort);
          const parent = segs.map((_, i) => i);
          const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
          for (let a = 0; a < segs.length; a++) {
            for (let b = a + 1; b < segs.length; b++) {
              const A = segs[a], B = segs[b];
              if (A.e.id === B.e.id || !sameDecisionSide(A, B)) continue;
              if (Math.abs(A.pos - B.pos) >= DECISION_TRACK_GAP - 0.5) continue;
              if (Math.min(A.hi, B.hi) - Math.max(A.lo, B.lo) <= 2) continue;
              parent[find(a)] = find(b);
            }
          }
          const clusters = {};
          segs.forEach((s, idx) => { (clusters[find(idx)] = clusters[find(idx)] || []).push(s); });
          Object.values(clusters).forEach(cl => {
            if (cl.length < 2) return;
            cl.sort((p, q) => {
              if (Math.abs(p.pos - q.pos) >= 1) return p.pos - q.pos;
              const sharedFrom = p.e.from === q.e.from;
              const nodeP = sharedFrom ? rects[p.e.to] : rects[p.e.from];
              const nodeQ = sharedFrom ? rects[q.e.to] : rects[q.e.from];
              return orient === 'v' ? nodeP.cx - nodeQ.cx : nodeP.cy - nodeQ.cy;
            });
            const meanPos = cl.reduce((sum, s) => sum + s.pos, 0) / cl.length;
            let minBase = -Infinity, maxBase = Infinity;
            cl.forEach((s, idx) => {
              const pts = edgePolylines[s.e.id];
              const off = (idx - (cl.length - 1) / 2) * DECISION_TRACK_GAP;
              const prev = pts[s.i - 1][k], next = pts[s.i + 2][k];
              const old = s.pos;
              const dPrev = Math.sign(old - prev);
              if (dPrev > 0) minBase = Math.max(minBase, prev + 8 - off);
              else if (dPrev < 0) maxBase = Math.min(maxBase, prev - 8 - off);
              const dNext = Math.sign(next - old);
              if (dNext > 0) maxBase = Math.min(maxBase, next - 8 - off);
              else if (dNext < 0) minBase = Math.max(minBase, next + 8 - off);
            });
            const basePos = minBase <= maxBase ? Math.max(minBase, Math.min(maxBase, meanPos)) : meanPos;
            const saved = cl.map(s => [edgePolylines[s.e.id][s.i][k], edgePolylines[s.e.id][s.i + 1][k]]);
            let allValid = true;
            cl.forEach((s, idx) => {
              const pts = edgePolylines[s.e.id];
              const target = basePos + (idx - (cl.length - 1) / 2) * DECISION_TRACK_GAP;
              const prev = pts[s.i - 1][k], next = pts[s.i + 2][k], old = saved[idx][0];
              if ((old !== prev && (Math.sign(target - prev) !== Math.sign(old - prev) || Math.abs(target - prev) < 8)) ||
                  (next !== old && (Math.sign(next - target) !== Math.sign(next - old) || Math.abs(next - target) < 8))) {
                allValid = false;
              }
              pts[s.i][k] = target;
              pts[s.i + 1][k] = target;
            });
            if (!allValid || !cl.every(s => polyClear(edgePolylines[s.e.id], [s.e.from, s.e.to]) && ownBodyClear(edgePolylines[s.e.id], s.e))) {
              cl.forEach((s, idx) => {
                const pts = edgePolylines[s.e.id];
                pts[s.i][k] = saved[idx][0];
                pts[s.i + 1][k] = saved[idx][1];
              });
            }
          });
        });

        // 5c. Two-way connections (A->B plus B->A) between vertically stacked nodes: draw them as two
        // straight parallel arrows, side by side, instead of two lines that swap sides and have to hop.
        {
          const PAIR_GAP = 20;
          const done = new Set();
          validEdges.forEach(a => {
            if (done.has(a.id)) return;
            const b = validEdges.find(o => o !== a && o.from === a.to && o.to === a.from && !done.has(o.id));
            if (!b) return;
            const pa = edgePolylines[a.id], pb = edgePolylines[b.id];
            const f = rects[a.from], t = rects[a.to];
            if (!pa || !pb || !f || !t) return;
            const vertEnds = pts => pts.length >= 2 && Math.abs(pts[0][0] - pts[1][0]) < 1 &&
              Math.abs(pts[pts.length - 1][0] - pts[pts.length - 2][0]) < 1;
            if (!vertEnds(pa) || !vertEnds(pb)) return;
            const lo = Math.max(f.x, t.x) + 14, hi = Math.min(f.x + f.w, t.x + t.w) - 14;
            if (hi - lo < PAIR_GAP) {
              // Nodes offset sideways: two nested S-shapes. The downward arrow takes the inner side at both
              // ends and the lower crossbar; the upward arrow the outer side and the upper crossbar.
              const aDown = f.y < t.y;
              const U = aDown ? f : t, L = aDown ? t : f;
              const y0 = U.y + U.h, y1 = L.y;
              if (y1 - y0 < 48 || Math.abs(L.cx - U.cx) < 30) return;
              const sgn = L.cx > U.cx ? 1 : -1, h = PAIR_GAP / 2;
              const midY = (y0 + y1) / 2;
              // Centre of the pair on one node side: nearest to the node centre where neither line sits
              // within 14px of another arrow's contact point on that side
              const pickCentre = (nodeId, node, edgeY) => {
                const others = [];
                validEdges.forEach(o => {
                  if (o === a || o === b) return;
                  const q = edgePolylines[o.id];
                  if (!q) return;
                  if (o.from === nodeId && Math.abs(q[0][1] - edgeY) < 1) others.push(q[0][0]);
                  if (o.to === nodeId && Math.abs(q[q.length - 1][1] - edgeY) < 1) others.push(q[q.length - 1][0]);
                });
                const lo2 = node.x + 14 + h, hi2 = node.x + node.w - 14 - h;
                for (let d = 0; d <= 60; d += 4) {
                  for (const c of d ? [node.cx - d, node.cx + d] : [node.cx]) {
                    if (c < lo2 || c > hi2) continue;
                    if (others.every(ox => Math.abs(ox - (c - h)) >= 14 && Math.abs(ox - (c + h)) >= 14)) return c;
                  }
                }
                return node.cx;
              };
              const uId = aDown ? a.from : a.to, lId = aDown ? a.to : a.from;
              const cU = pickCentre(uId, U, y0), cL = pickCentre(lId, L, y1);
              const down = [[cU - h * sgn, y0], [cU - h * sgn, midY + 6], [cL - h * sgn, midY + 6], [cL - h * sgn, y1]];
              const up = [[cL + h * sgn, y1], [cL + h * sgn, midY - 6], [cU + h * sgn, midY - 6], [cU + h * sgn, y0]];
              const [sa2, sb2] = aDown ? [down, up] : [up, down];
              if (!polyClear(sa2, [a.from, a.to]) || !polyClear(sb2, [b.from, b.to])) return;
              edgePolylines[a.id] = sa2;
              edgePolylines[b.id] = sb2;
              done.add(a.id); done.add(b.id);
              return;
            }
            const c = Math.max(lo + PAIR_GAP / 2, Math.min(hi - PAIR_GAP / 2, (f.cx + t.cx) / 2));
            const xa = c - PAIR_GAP / 2, xb = c + PAIR_GAP / 2;
            const sa = [[xa, pa[0][1]], [xa, pa[pa.length - 1][1]]];
            const sb = [[xb, pb[0][1]], [xb, pb[pb.length - 1][1]]];
            if (!polyClear(sa, [a.from, a.to]) || !polyClear(sb, [b.from, b.to])) return;
            edgePolylines[a.id] = sa;
            edgePolylines[b.id] = sb;
            done.add(a.id); done.add(b.id);
          });
        }

        // 5c2. Tiny jogs: an end leg offset from the leg before it by less than two corner radii draws a cramped
        // S-bend whose corners cannot take the normal radius (nodes a few px apart, or a contact point spread
        // a few px off centre). Slide the end along its node's flat side to line up with the leg instead, when
        // that spot is on the side, is not a diamond vertex, and keeps CLEAR from other arrows' contact points.
        {
          const JOG = 16, CLEAR_PT = 24;
          const ends = (nid, skipId) => {
            const out = [];
            validEdges.forEach(o => {
              if (o.id === skipId) return;
              const op = edgePolylines[o.id];
              if (!op) return;
              if (o.from === nid) out.push(op[0]);
              if (o.to === nid) out.push(op[op.length - 1]);
            });
            return out;
          };
          validEdges.forEach(e => {
            const pts = edgePolylines[e.id];
            if (!pts || pts.length < 4) return;
            // [end, leg, jog, rest]: indices for the source end, then for the target end
            [[e.from, 0, 1, 2, 3], [e.to, pts.length - 1, pts.length - 2, pts.length - 3, pts.length - 4]].forEach(([nid, a, b, c, d]) => {
              const node = nodeMap[nid], r = rects[nid];
              if (!node || !r || node.type === 'decision') return;
              const vertLeg = Math.abs(pts[a][0] - pts[b][0]) < 1 && Math.abs(pts[c][0] - pts[d][0]) < 1 && Math.abs(pts[b][1] - pts[c][1]) < 1;
              const horizLeg = Math.abs(pts[a][1] - pts[b][1]) < 1 && Math.abs(pts[c][1] - pts[d][1]) < 1 && Math.abs(pts[b][0] - pts[c][0]) < 1;
              const ax = vertLeg ? 0 : horizLeg ? 1 : -1;      // the coordinate that slides along the node's side
              if (ax < 0) return;
              const target = pts[c][ax];
              const off = Math.abs(target - pts[a][ax]);
              if (off < 0.5 || off >= JOG) return;
              const lo = ax === 0 ? r.x + 14 : r.y + 14, hi = ax === 0 ? r.x + r.w - 14 : r.y + r.h - 14;
              if (target < lo || target > hi) return;
              const side = pts[a][1 - ax];
              const crowded = ends(nid, e.id).some(p => Math.abs(p[1 - ax] - side) < 1 &&
                Math.abs(p[ax] - target) >= 1 && Math.abs(p[ax] - target) < CLEAR_PT);
              if (crowded) return;
              pts[a][ax] = target;
              pts[b][ax] = target;
            });
          });
        }

        // 5e. Top-to-bottom: back to screen coordinates (flow x -> screen y). A port named in flow terms maps to the
        // screen side it faces: along the flow ('right') is down, against it ('left') up, across the lanes sideways.
        if (tb) {
          const SIDE = { right: 'bottom', left: 'top', bottom: 'right', top: 'left' };
          Object.keys(edgePolylines).forEach(id => { edgePolylines[id] = edgePolylines[id].map(([a, b]) => [b, a]); });
          Object.keys(edgePorts).forEach(id => {
            const p = edgePorts[id];
            if (p) edgePorts[id] = { ...p, fromPort: SIDE[p.fromPort] || p.fromPort, toPort: SIDE[p.toPort] || p.toPort };
          });
          Object.values(rects).forEach(r => {
            [r.x, r.y, r.w, r.h, r.cx, r.cy] = [r.y, r.x, r.h, r.w, r.cy, r.cx];
          });
        }

        // 5f. Arrow ends on the outline. The router ends arrows on the node's box; a shaped node's outline runs inside
        // it in places (a diamond's sides away from the vertices, the io's slant, the cylinder's ellipses, the delay's
        // arc, the document's wave), so an end there would stop in mid-air. Slide each such end along its end leg
        // onto the outline (outlineInset). Runs in screen coordinates (after 5e): shapes keep their screen orientation
        // in a top-to-bottom diagram, so the side that matters is the screen side.
        validEdges.forEach(e => {
          const pts = edgePolylines[e.id];
          if (!pts || pts.length < 2) return;
          const snap = (nid, a, b) => {
            const node = nodeMap[nid], r = rects[nid];
            if (!node || !r || !outlineInset) return;
            const vertLeg = Math.abs(pts[a][0] - pts[b][0]) < 1, horizLeg = Math.abs(pts[a][1] - pts[b][1]) < 1;
            let side = null;
            if (vertLeg && Math.abs(pts[a][1] - r.y) < 1) side = 'top';
            else if (vertLeg && Math.abs(pts[a][1] - (r.y + r.h)) < 1) side = 'bottom';
            else if (horizLeg && Math.abs(pts[a][0] - r.x) < 1) side = 'left';
            else if (horizLeg && Math.abs(pts[a][0] - (r.x + r.w)) < 1) side = 'right';
            if (!side) return;
            const ax = (side === 'top' || side === 'bottom') ? 1 : 0;   // the coordinate that moves
            const inset = outlineInset(node, r, side, pts[a][1 - ax]);
            if (inset < 0.5) return;
            const nv = (side === 'top' || side === 'left') ? pts[a][ax] + inset : pts[a][ax] - inset;
            // keep the leg pointing the same way and at least 4px long
            if (Math.abs(pts[b][ax] - nv) >= 4 && Math.sign(pts[b][ax] - nv) === Math.sign(pts[b][ax] - pts[a][ax])) pts[a][ax] = nv;
          };
          snap(e.from, 0, 1);
          snap(e.to, pts.length - 1, pts.length - 2);
        });

        // 5z. A Z with a small jog (out of one side, a short step, into the opposite side) between two steps that nearly line up:
        // one end slides along its own straight edge so the arrow runs level. The end that moves is a plain box, and the other end's
        // height (a diamond's vertex, say) must lie inside it.
        const SLIDES = new Set(['task', 'subprocess', 'document']);
        validEdges.forEach(e => {
          const pts = edgePolylines[e.id];
          if (!pts || pts.length !== 4) return;
          const [a, b, c, d] = pts;
          if (Math.abs(a[1] - b[1]) > 0.5 || Math.abs(b[0] - c[0]) > 0.5 || Math.abs(c[1] - d[1]) > 0.5) return;
          const dy = d[1] - a[1];
          if (Math.abs(dy) < 0.5 || Math.abs(dy) > 28 || Math.abs(d[0] - a[0]) < 30) return;
          const fits = (id, y) => {
            const n = nodeMap[id], r = rects[id];
            if (!n || !r || !SLIDES.has(n.type)) return false;
            const m = n.type === 'document' ? 10 : 6;
            return y > r.y + m && y < r.y + r.h - m;
          };
          if (fits(e.from, d[1])) edgePolylines[e.id] = [[a[0], d[1]], d];
          else if (fits(e.to, a[1])) edgePolylines[e.id] = [a, [d[0], a[1]]];
        });

        // 6. Collect vertical segments from edges for planar bridge/hop overpasses
        const verticalSegments = [];
        validEdges.forEach(other => {
          const pts = edgePolylines[other.id];
          if (!pts) return;
          for (let i = 0; i < pts.length - 1; i++) {
            if (Math.abs(pts[i][0] - pts[i + 1][0]) < 1) {
              const vx = pts[i][0];
              const yMin = Math.min(pts[i][1], pts[i + 1][1]);
              const yMax = Math.max(pts[i][1], pts[i + 1][1]);
              verticalSegments.push({ edgeId: other.id, x: vx, yMin, yMax });
            }
          }
        });

        // 7. Second pass: choose collision-free label coordinates and generate curved/hop path
        const placedLabels = [];
        const allNodeBoxes = Object.values(rects);
        const routes = {};

        validEdges.forEach(e => {
          const p = edgePorts[e.id];
          const points = edgePolylines[e.id];

          const otherObstacles = verticalSegments.filter(obs => {
            if (obs.edgeId === e.id) return false;
            const otherE = chartData.edges.find(ed => ed.id === obs.edgeId);
            // Forks (same source) and true merges (same target, same entry side) meet on purpose. Two arrows
            // into one node through different sides are separate lines, so where they cross, one hops.
            // Only exempt them when they really share the contact point: arrows entering one side at
            // different x positions are separate lines, so a crossing between them must still hop.
            const oPts = edgePolylines[obs.edgeId];
            if (otherE && otherE.from === e.from && oPts && Math.abs(oPts[0][0] - points[0][0]) < 2 && Math.abs(oPts[0][1] - points[0][1]) < 2) return false;
            if (otherE && otherE.to === e.to && edgePorts[otherE.id] && edgePorts[otherE.id].toPort === p.toPort &&
                oPts && Math.abs(oPts[oPts.length - 1][0] - points[points.length - 1][0]) < 2 && Math.abs(oPts[oPts.length - 1][1] - points[points.length - 1][1]) < 2) return false;
            return true;
          });

          const d = buildCurvedPathWithHops(points, otherObstacles, 8);

          const otherPolylines = [];
          validEdges.forEach(other => {
            if (other.id !== e.id && edgePolylines[other.id]) {
              otherPolylines.push(edgePolylines[other.id]);
            }
          });

          const labelPos = pickClearLabelPosition(points, p.fromPort, e.label, allNodeBoxes, placedLabels, otherPolylines, labelMaxW);
          if (e.label && e.label.trim()) {
            // Reserve the box the label is drawn in: one line is estimated generously; a wrapped label is as wide
            // as its wrap width and as tall as its lines (a 28px box let the next label sit on its second line)
            const lw = labelPos.wrapped ? labelPos.w : Math.max(48, e.label.length * FONT_M.edgeLabel + 20);
            const lh = Math.max(28, labelPos.h);
            placedLabels.push({ x: labelPos.x - lw / 2, y: labelPos.y - lh / 2, w: lw, h: lh });
          }

          routes[e.id] = {
            path: d,
            points,   // final polyline (container coords): used to find the arrow under a dragged node
            midX: labelPos.x,
            midY: labelPos.y,
            fromRect: rects[e.from],
            toRect: rects[e.to],
          };
        });

        return routes;
      }

      function buildCurvedPathWithHops(points, verticalObstacles, r = 8) {
        if (!points || points.length === 0) return '';
        if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;

        // Drop repeated and collinear points: a zero-length segment or a straight "corner" would otherwise
        // leave the real bend next to it unrounded
        points = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 0.5);
        points = points.filter((p, i) => {
          if (i === 0 || i === points.length - 1) return true;
          const a = points[i - 1], b = points[i + 1];
          return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 0.5;
        });

        // Insert bridge hop markers along horizontal segments that cross other vertical edges
        const expanded = [points[0]];
        for (let i = 0; i < points.length - 1; i++) {
          const p1 = points[i];
          const p2 = points[i + 1];
          const isHorizontal = Math.abs(p1[1] - p2[1]) < 1;

          if (isHorizontal && verticalObstacles && verticalObstacles.length > 0) {
            const y = p1[1];
            const minX = Math.min(p1[0], p2[0]);
            const maxX = Math.max(p1[0], p2[0]);
            const goingRight = p2[0] > p1[0];
            // Room a hop needs from each end of the segment: past a bend, the corner's radius plus the hop's
            // (8 + 6); at the arrow's source, just the hop plus a little; at its target, room for the arrowhead (about 14px).
            // (A flat 18px dropped crossings next to a source, e.g. an arrow rising just right of a decision vertex.)
            const endRoom = (k) => (k === 0 ? 8 : k === points.length - 1 ? 22 : 14);
            const lo1 = endRoom(i), lo2 = endRoom(i + 1);
            const minRoom = goingRight ? lo1 : lo2, maxRoom = goingRight ? lo2 : lo1;

            const hops = [];
            verticalObstacles.forEach(obs => {
              const vx = obs.x;
              if (vx > minX + minRoom && vx < maxX - maxRoom && y > obs.yMin + 8 && y < obs.yMax - 8) {
                hops.push(vx);
              }
            });

            hops.sort((a, b) => goingRight ? a - b : b - a);
            hops.forEach(vx => {
              expanded.push({ isHop: true, x: vx, y: y, dir: goingRight ? 1 : -1 });
            });
          }
          expanded.push(p2);
        }

        // Render rounded quarter-arc corners (r=8) and semicircular hops (r=6). Every bend gets the same radius r;
        // it shrinks only when a segment is too short to hold it (a segment shared by two bends gives each half).
        const hopR = 6;
        const hopEdge = (h, side) => [h.x + side * hopR * h.dir, h.y];   // side -1: where the hop starts, +1: ends
        let d = `M ${expanded[0][0]} ${expanded[0][1]}`;
        for (let i = 1; i < expanded.length; i++) {
          const item = expanded[i];
          if (item.isHop) {
            const hx = item.x;
            const hy = item.y;
            const dir = item.dir;
            d += ` L ${(hx - hopR * dir).toFixed(1)} ${hy.toFixed(1)}`;
            d += ` A ${hopR} ${hopR} 0 0 1 ${(hx + hopR * dir).toFixed(1)} ${hy.toFixed(1)}`;
            continue;
          }

          const prev = expanded[i - 1];
          const next = i < expanded.length - 1 ? expanded[i + 1] : null;

          if (next) {
            // A hop next to the bend bounds that segment like an end point does (its arc needs the rest)
            const pPrev = prev.isHop ? hopEdge(prev, 1) : prev;
            const pCurr = item;
            const pNext = next.isHop ? hopEdge(next, -1) : next;

            const vIn = [pCurr[0] - pPrev[0], pCurr[1] - pPrev[1]];
            const vOut = [pNext[0] - pCurr[0], pNext[1] - pCurr[1]];
            const lenIn = Math.hypot(vIn[0], vIn[1]);
            const lenOut = Math.hypot(vOut[0], vOut[1]);

            if (lenIn > 0.5 && lenOut > 0.5) {
              // The first segment and hop-bounded segments belong to this bend alone; others are shared
              const roomIn = (i - 1 === 0 || prev.isHop) ? lenIn : lenIn / 2;
              const roomOut = next.isHop ? lenOut : lenOut / 2;
              const curR = Math.min(r, roomIn, roomOut);
              const startX = pCurr[0] - (vIn[0] / lenIn) * curR;
              const startY = pCurr[1] - (vIn[1] / lenIn) * curR;
              const endX = pCurr[0] + (vOut[0] / lenOut) * curR;
              const endY = pCurr[1] + (vOut[1] / lenOut) * curR;

              d += ` L ${startX.toFixed(1)} ${startY.toFixed(1)}`;
              d += ` Q ${pCurr[0].toFixed(1)} ${pCurr[1].toFixed(1)} ${endX.toFixed(1)} ${endY.toFixed(1)}`;
              continue;
            }
          }
          d += ` L ${item[0]} ${item[1]}`;
        }
        return d;
      }

      const ARROWHEAD_LEN = 16;   // the arrowhead marker's length in px at the 1.25px line width (stage.html)

      function pickClearLabelPosition(points, fromPort, labelText, nodeBoxes, placedLabels, otherPolylines, labelMaxW) {
        const FONT_M = TOKENS.font.metrics;
        const candidates = [];

        if (points.length === 2) {
          // Centred on the part of the line the arrowhead leaves free, plus staggered spots if a neighbour label sits at mid
          const [a, b] = points, len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const free = Math.max(0, len - ARROWHEAD_LEN);
          for (const frac of [0.5, 0.25, 0.78]) {
            const t = (free * frac) / len;
            candidates.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t });
          }
        } else if (points.length === 3) {
          const p0 = points[0], p1 = points[1], p2 = points[2];
          const seg1Len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1;
          const free1 = Math.max(0, seg1Len - ARROWHEAD_LEN);
          const seg1Cand = { x: p1[0] + (p2[0] - p1[0]) * (free1 * 0.5 / seg1Len), y: p1[1] + (p2[1] - p1[1]) * (free1 * 0.5 / seg1Len) };
          if (fromPort === 'top' || fromPort === 'bottom') {
            const sign = p1[1] > p0[1] ? 1 : -1;
            const distY = Math.abs(p1[1] - p0[1]);
            candidates.push({
              x: p0[0],
              y: p0[1] + sign * Math.min(34, distY * 0.45)
            });
            candidates.push(seg1Cand);
          } else {
            candidates.push({
              x: (p0[0] + p1[0]) / 2,
              y: p0[1]
            });
            // The second leg too: a short first leg (an arrow into a connector beside its step) has no room
            candidates.push(seg1Cand);
          }
          if (free1 >= 36) {
            for (const frac of [0.24, 0.78]) {
              const t1 = (free1 * frac) / seg1Len;
              candidates.push({ x: p1[0] + (p2[0] - p1[0]) * t1, y: p1[1] + (p2[1] - p1[1]) * t1 });
            }
          }
        } else if (points.length >= 4) {
          const p0 = points[0];
          const p1 = points[1];
          const p2 = points[2];
          const p3 = points[3];

          if (Math.abs(p1[0] - p2[0]) < 2) {
            for (const t of [0.5, 0.22, 0.78, 0.35, 0.65]) {
              candidates.push({
                x: p1[0],
                y: p1[1] + (p2[1] - p1[1]) * t
              });
            }
          } else {
            candidates.push({
              x: (p1[0] + p2[0]) / 2,
              y: (p1[1] + p2[1]) / 2
            });
          }
          candidates.push({ x: (p0[0] + p1[0]) / 2, y: (p0[1] + p1[1]) / 2 });
          candidates.push({ x: (p2[0] + p3[0]) / 2, y: (p2[1] + p3[1]) / 2 });
          if (points.length >= 5) {
            const p4 = points[4];
            candidates.push({ x: (p3[0] + p4[0]) / 2, y: (p3[1] + p4[1]) / 2 });
          }
        }

        // Fallback spots along every long segment, tried after the preferred ones above (middle outwards,
        // 22px clear of corners and clear of the arrowhead on the final leg). Without them a label whose
        // preferred spot sits on a crossing, junction, or node box had nowhere else to go.
        for (let i = 0; i < points.length - 1; i++) {
          const p = points[i], q = points[i + 1];
          const len = Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]);
          const isLast = i === points.length - 2;
          const endClear = isLast ? Math.max(22, ARROWHEAD_LEN + 8) : 22;
          if (len >= 56) {
            for (const t of [0.5, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85]) {
              if (len * t < 22 || len * (1 - t) < endClear) continue;
              candidates.push({ x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t });
            }
          } else if (len >= 34) {
            const t = isLast ? Math.max(0.15, (len - ARROWHEAD_LEN) / 2 / len) : 0.5;
            candidates.push({ x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t });
          }
        }

        // Stretches of this arrow that another arrow runs along (collinear overlap): a label there could
        // belong to either arrow, so it must sit on a part of its own line that only it occupies.
        const sharedStretches = [];
        if (otherPolylines) {
          for (let i = 0; i < points.length - 1; i++) {
            const p = points[i], q = points[i + 1];
            const isV = Math.abs(p[0] - q[0]) < 1, isH = Math.abs(p[1] - q[1]) < 1;
            if (!isV && !isH) continue;
            const k = isV ? 0 : 1, m = 1 - k;                       // k: fixed axis, m: running axis
            const lo = Math.min(p[m], q[m]), hi = Math.max(p[m], q[m]);
            for (const poly of otherPolylines) {
              for (let j = 0; j < poly.length - 1; j++) {
                const c = poly[j], d = poly[j + 1];
                if (Math.abs(c[k] - d[k]) >= 1 || Math.abs(c[k] - p[k]) >= 2) continue;
                const a0 = Math.max(lo, Math.min(c[m], d[m])), a1 = Math.min(hi, Math.max(c[m], d[m]));
                if (a1 - a0 > 2) sharedStretches.push(isV ? { x: p[0], y: a0, w: 0, h: a1 - a0 } : { x: a0, y: p[1], w: a1 - a0, h: 0 });
              }
            }
          }
        }
        // Dense spots along every long segment, so a short clear stretch (e.g. next to the source) is found
        if (sharedStretches.length) {
          for (let i = 0; i < points.length - 1; i++) {
            const p = points[i], q = points[i + 1];
            const len = Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]);
            if (len < 56) continue;
            for (let d = 22; d <= len - 22; d += 14) {
              const t = d / len;
              candidates.push({ x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t });
            }
          }
        }

        // Where every long stretch is shared, a short leg only this arrow uses (about a label tall) is the one
        // place the label belongs to it alone: try its middle, touching the node box (a diamond tip sits inside its box).
        if (sharedStretches.length) {
          for (let i = 0; i < points.length - 1; i++) {
            const p = points[i], q = points[i + 1];
            const len = Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]);
            if (len >= 26 && len < 56) candidates.push({ x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2, pad: -2 });
          }
        }

        const textLen = labelText ? labelText.trim().length : 0;
        const singleLineWidth = Math.max(40, textLen * FONT_M.edgeWrap + 18);
        let lw = singleLineWidth;
        let lh = 24;

        // Check horizontal span of edge points to determine available gap
        let horizClearance = null;
        if (points.length >= 2) {
          const minX = Math.min(...points.map(p => p[0]));
          const maxX = Math.max(...points.map(p => p[0]));
          if (maxX - minX > 50) {
            horizClearance = maxX - minX - 16;
          }
        }

        // Allow arrow labels to drop into multiple lines if 1 line exceeds the horizontal gap
        // Labels also never grow past LABEL_MAX_W (matches the CSS max-width); longer text wraps
        const wrapAt = Math.min(horizClearance || Infinity, labelMaxW);
        if (singleLineWidth > wrapAt) {
          // Never narrower than the longest word, so words are not split mid-word
          const longestWord = Math.max(0, ...String(labelText || '').trim().split(/\s+/).map(w => w.length));
          const minWordW = Math.max(40, longestWord * FONT_M.label + 20);
          lw = Math.max(minWordW, Math.min(singleLineWidth, wrapAt));
          const lines = Math.ceil(singleLineWidth / lw);
          lh = Math.max(24, lines * 15 + 8);
        }

        function BoxOverlap(bx, by, bw, bh, ox, oy, ow, oh, pad) {
          return (
            bx < ox + ow + pad &&
            bx + bw > ox - pad &&
            by < oy + oh + pad &&
            by + bh > oy - pad
          );
        }

        // The first spot that touches nothing wins. When every spot touches something, take the least bad one
        // (a node or another label is far worse than sitting on another arrow) instead of the first.
        let fallback = null;
        for (const cand of candidates) {
          const bx = cand.x - lw / 2;
          const by = cand.y - lh / 2;
          let penalty = 0;

          const hardPad = cand.pad !== undefined ? Math.min(0, cand.pad) : 0;
          const softPad = cand.pad ?? 8;
          for (const nb of nodeBoxes) {
            if (BoxOverlap(bx, by, lw, lh, nb.x, nb.y, nb.w, nb.h, hardPad)) {
              const ox = Math.min(bx + lw, nb.x + nb.w + hardPad) - Math.max(bx, nb.x - hardPad);
              const oy = Math.min(by + lh, nb.y + nb.h + hardPad) - Math.max(by, nb.y - hardPad);
              penalty += 4000 + Math.max(0, Math.min(ox, oy)) * 20;
            } else if (BoxOverlap(bx, by, lw, lh, nb.x, nb.y, nb.w, nb.h, softPad)) {
              penalty += 200;
            }
          }
          for (const pl of placedLabels) {
            if (BoxOverlap(bx, by, lw, lh, pl.x, pl.y, pl.w, pl.h, 0)) {
              const ox = Math.min(bx + lw, pl.x + pl.w) - Math.max(bx, pl.x);
              const oy = Math.min(by + lh, pl.y + pl.h) - Math.max(by, pl.y);
              penalty += 4000 + Math.max(0, Math.min(ox, oy)) * 20;
            } else if (BoxOverlap(bx, by, lw, lh, pl.x, pl.y, pl.w, pl.h, 6)) {
              penalty += 200;
            }
          }
          if (otherPolylines) {
            for (const poly of otherPolylines) {
              for (let i = 0; i < poly.length - 1; i++) {
                const sx = Math.min(poly[i][0], poly[i + 1][0]);
                const sy = Math.min(poly[i][1], poly[i + 1][1]);
                const sw = Math.abs(poly[i + 1][0] - poly[i][0]);
                const sh = Math.abs(poly[i + 1][1] - poly[i][1]);
                if (BoxOverlap(bx, by, lw, lh, sx, sy, sw, sh, 6)) penalty += 10;
              }
            }
          }
          for (const st of sharedStretches) {
            if (BoxOverlap(bx, by, lw, lh, st.x, st.y, st.w, st.h, 2)) { penalty += 600; break; }
          }
          if (penalty === 0) return { x: cand.x, y: cand.y, w: lw, h: lh, wrapped: lw < singleLineWidth };
          if (!fallback || penalty < fallback.penalty) fallback = { cand, penalty };
        }

        // The size checked here comes back with the spot, so the caller reserves the box the label really takes
        // (a wrapped label is narrower but taller than one line)
        const spot = fallback ? fallback.cand : (candidates[0] || { x: points[0][0], y: points[0][1] });
        return { x: spot.x, y: spot.y, w: lw, h: lh, wrapped: lw < singleLineWidth };
      }
// --- GANTT LAYOUT ENGINE ---
// Pure JS, no DOM access, no ES module imports. Defines layoutDiagram(data), GANTT_ZOOMS,
// and pure UTC date helpers (ganttParseDate, ganttFormatDate, ganttAddDays, ganttDiffDays).
// Loaded by the page and by scripts/run_engine.mjs with TOKENS in scope and ortho-router.js ahead of it.
// 100% deterministic: never calls Date.now() or new Date() without an explicit UTC date.

const GANTT_ZOOMS = {
  day:     { pxPerDay: 44,  snapDays: 1, showWeekends: true,  label: 'Day' },
  week:    { pxPerDay: 18,  snapDays: 1, showWeekends: true,  label: 'Week' },
  month:   { pxPerDay: 6,   snapDays: 1, showWeekends: false, label: 'Month' },
  quarter: { pxPerDay: 2.4, snapDays: 7, showWeekends: false, label: 'Quarter' },
  year:    { pxPerDay: 1.0, snapDays: 7, showWeekends: false, label: 'Year' }
};

const GANTT_PAD_DAYS = {
  day:     { before: 90,  after: 180 },
  week:    { before: 180, after: 365 },
  month:   { before: 365, after: 730 },
  quarter: { before: 730, after: 1095 },
  year:    { before: 730, after: 1460 }
};

const GANTT_FALLBACK_START = '2026-01-01';
const GANTT_FALLBACK_END   = '2026-03-31';

const GANTT_METRICS = {
  ROW_H: 44,
  BAR_H: 26,
  GROUP_BAR_H: 10,
  MILESTONE_SIZE: 16,
  HEADER_H: 58,
  SIDEBAR_W: 260,
  DEP_STUB: 14,
  DEP_RADIUS: 6,
  CHAR_W: (typeof TOKENS !== 'undefined' && TOKENS && TOKENS.font && TOKENS.font.metrics && TOKENS.font.metrics.label) || 7.4
};

const GANTT_MS_PER_DAY = 86400000;

function ganttParseDate(input) {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  }
  if (typeof input !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

function ganttFormatDate(input) {
  const dt = ganttParseDate(input);
  if (!dt) return '';
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function ganttAddDays(dateStr, days) {
  const dt = ganttParseDate(dateStr);
  if (!dt) return '';
  const delta = Math.trunc(Number(days) || 0);
  return ganttFormatDate(new Date(dt.getTime() + delta * GANTT_MS_PER_DAY));
}

function ganttDiffDays(startStr, endStr) {
  const a = ganttParseDate(startStr);
  const b = ganttParseDate(endStr);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / GANTT_MS_PER_DAY);
}

function ganttRound1(n) {
  return Math.round(n * 10) / 10;
}

function ganttRoundPath(points, r) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  const radius = typeof r === 'number' ? r : GANTT_METRICS.DEP_RADIUS;
  // Drop duplicate and collinear intermediate points
  const pts = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (pts.length > 0 && Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) <= 0.5) continue;
    pts.push(p);
  }
  const clean = pts.filter((p, i) => {
    if (i === 0 || i === pts.length - 1) return true;
    const a = pts[i - 1], b = pts[i + 1];
    return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 0.5;
  });
  let d = `M ${clean[0][0]} ${clean[0][1]}`;
  for (let i = 1; i < clean.length; i++) {
    const curr = clean[i];
    if (i < clean.length - 1) {
      const prev = clean[i - 1];
      const next = clean[i + 1];
      const vx1 = curr[0] - prev[0], vy1 = curr[1] - prev[1];
      const vx2 = next[0] - curr[0], vy2 = next[1] - curr[1];
      const len1 = Math.hypot(vx1, vy1);
      const len2 = Math.hypot(vx2, vy2);
      if (len1 > 0.5 && len2 > 0.5) {
        const room1 = i === 1 ? len1 : len1 / 2;
        const room2 = i === clean.length - 2 ? len2 : len2 / 2;
        const cr = Math.min(radius, room1, room2);
        const sx = curr[0] - (vx1 / len1) * cr;
        const sy = curr[1] - (vy1 / len1) * cr;
        const ex = curr[0] + (vx2 / len2) * cr;
        const ey = curr[1] + (vy2 / len2) * cr;
        d += ` L ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${curr[0].toFixed(1)} ${curr[1].toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
        continue;
      }
    }
    d += ` L ${curr[0]} ${curr[1]}`;
  }
  return d;
}

function ganttBuildDepPath(points, r) {
  if (typeof buildCurvedPathWithHops === 'function') {
    return buildCurvedPathWithHops(points, [], r);
  }
  return ganttRoundPath(points, r);
}

function layoutDiagram(data) {
  const items = Array.isArray(data.items) ? data.items : [];
  const deps = Array.isArray(data.dependencies) ? data.dependencies : [];
  const markers = Array.isArray(data.markers) ? data.markers : [];
  const holidays = Array.isArray(data.holidays) ? data.holidays : [];

  const zoomKey = Object.prototype.hasOwnProperty.call(GANTT_ZOOMS, data.zoom) ? data.zoom : 'month';
  const zoomCfg = GANTT_ZOOMS[zoomKey];
  const padCfg = GANTT_PAD_DAYS[zoomKey];
  const pxPerDay = zoomCfg.pxPerDay;

  // 1. Index items by id and build parent -> children tree (preserving items array order among siblings)
  const itemById = new Map();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it && it.id && !itemById.has(it.id)) itemById.set(it.id, it);
  }

  // Resolve valid non-cyclic parent for each item
  const validParent = new Map();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || !it.id) continue;
    const pid = it.parent;
    if (!pid || pid === it.id || !itemById.has(pid)) {
      validParent.set(it.id, null);
      continue;
    }
    // Walk ancestors to guard against parent cycles
    const seen = new Set([it.id]);
    let cur = pid;
    let cyclic = false;
    while (cur && itemById.has(cur)) {
      if (seen.has(cur)) { cyclic = true; break; }
      seen.add(cur);
      cur = itemById.get(cur).parent;
    }
    validParent.set(it.id, cyclic ? null : pid);
  }

  const roots = [];
  const childrenByParent = new Map();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || !it.id) continue;
    const pid = validParent.get(it.id);
    if (!pid) {
      roots.push(it);
    } else {
      let arr = childrenByParent.get(pid);
      if (!arr) { arr = []; childrenByParent.set(pid, arr); }
      arr.push(it);
    }
  }

  // 2. Depth-first traversal: compute _depth, _hasChildren, _hidden, _row, and bottom-up _start/_end rollup
  let visibleRow = 0;
  const orderedItems = [];

  function visit(it, depth, ancestorCollapsed) {
    const kids = childrenByParent.get(it.id) || [];
    it._depth = depth;
    it._hasChildren = kids.length > 0;
    it._hidden = Boolean(ancestorCollapsed);
    it._row = it._hidden ? -1 : visibleRow++;
    orderedItems.push(it);

    const childHidden = ancestorCollapsed || Boolean(it.collapsed);
    let minStart = null;
    let maxEnd = null;
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i];
      visit(child, depth + 1, childHidden);
      if (child._start && (!minStart || child._start < minStart)) minStart = child._start;
      if (child._end && (!maxEnd || child._end > maxEnd)) maxEnd = child._end;
    }

    if (it._hasChildren && minStart && maxEnd) {
      it._start = minStart;
      it._end = maxEnd;
    } else {
      const s = ganttFormatDate(it.start);
      const e = ganttFormatDate(it.end);
      if (it.kind === 'milestone') {
        const d = s || e || null;
        it._start = d;
        it._end = d;
      } else if (s && e) {
        it._start = s;
        it._end = e < s ? s : e;
      } else if (s) {
        it._start = s;
        it._end = s;
      } else if (e) {
        it._start = e;
        it._end = e;
      } else {
        it._start = null;
        it._end = null;
      }
    }
  }

  for (let i = 0; i < roots.length; i++) {
    visit(roots[i], 0, false);
  }

  // 3. Compute padded date range
  let earliest = null;
  let latest = null;
  for (let i = 0; i < orderedItems.length; i++) {
    const it = orderedItems[i];
    if (it._start && (!earliest || it._start < earliest)) earliest = it._start;
    if (it._end && (!latest || it._end > latest)) latest = it._end;
  }
  for (let i = 0; i < markers.length; i++) {
    const d = ganttFormatDate(markers[i] && markers[i].date);
    if (d) {
      if (!earliest || d < earliest) earliest = d;
      if (!latest || d > latest) latest = d;
    }
  }

  let rangeStart, rangeEnd;
  if (!earliest || !latest) {
    rangeStart = GANTT_FALLBACK_START;
    rangeEnd = GANTT_FALLBACK_END;
  } else {
    rangeStart = ganttAddDays(earliest, -padCfg.before);
    rangeEnd = ganttAddDays(latest, padCfg.after);
  }

  const contentStart = earliest || rangeStart;
  const contentEnd = latest || rangeEnd;

  const extraStart = ganttFormatDate(data._extraStart);
  if (extraStart && extraStart < rangeStart) rangeStart = extraStart;
  const extraEnd = ganttFormatDate(data._extraEnd);
  if (extraEnd && extraEnd > rangeEnd) rangeEnd = extraEnd;

  const totalDays = Math.max(1, ganttDiffDays(rangeStart, rangeEnd) + 1);
  const timelineWidth = Math.round(totalDays * pxPerDay);
  data._range = {
    start: rangeStart,
    end: rangeEnd,
    contentStart,
    contentEnd,
    totalDays,
    pxPerDay,
    timelineWidth
  };

  const dateToX = (dateStr) => ganttDiffDays(rangeStart, dateStr) * pxPerDay;

  // 4. Compute bar geometry for each item
  const ROW_H = GANTT_METRICS.ROW_H;
  const BAR_H = GANTT_METRICS.BAR_H;
  const GROUP_BAR_H = GANTT_METRICS.GROUP_BAR_H;
  const MS_SIZE = GANTT_METRICS.MILESTONE_SIZE;

  for (let i = 0; i < orderedItems.length; i++) {
    const it = orderedItems[i];
    if (it._hidden || !it._start || !it._end) {
      it._bar = null;
      continue;
    }
    const rowTop = it._row * ROW_H;
    if (it.kind === 'milestone' && !it._hasChildren) {
      const cx = ganttRound1(dateToX(it._start) + pxPerDay / 2);
      const cy = ganttRound1(rowTop + ROW_H / 2);
      it._bar = {
        x: ganttRound1(cx - MS_SIZE / 2),
        y: ganttRound1(cy - MS_SIZE / 2),
        w: MS_SIZE,
        h: MS_SIZE
      };
    } else {
      const spanDays = Math.max(1, ganttDiffDays(it._start, it._end) + 1);
      const h = (it._hasChildren || it.kind === 'group') ? GROUP_BAR_H : BAR_H;
      const x = ganttRound1(dateToX(it._start));
      const w = ganttRound1(spanDays * pxPerDay);
      const y = ganttRound1(rowTop + (ROW_H - h) / 2);
      it._bar = { x, y, w, h };
    }
  }

  // 5. Route dependencies (FS & SS) between visible items
  const DEP_R = GANTT_METRICS.DEP_RADIUS;
  const routedDeps = [];

  // Track which visible items have both incoming left-edge arrows and outgoing SS left-edge arrows
  // so we separate their vertical attachment points cleanly (no overlapping Y-fork on the arrowhead).
  const hasIncomingLeft = new Set();
  const hasOutgoingSs = new Set();
  for (let i = 0; i < deps.length; i++) {
    const dep = deps[i];
    if (!dep || !dep.from || !dep.to || dep.from === dep.to) continue;
    const f = itemById.get(dep.from);
    const t = itemById.get(dep.to);
    if (!f || !t || f._hidden || t._hidden || !f._bar || !t._bar) continue;
    hasIncomingLeft.add(dep.to);
    const rt = String(dep.type || 'fs').toLowerCase();
    if (rt === 'ss' || rt === 'start-start') hasOutgoingSs.add(dep.from);
  }

  for (let i = 0; i < deps.length; i++) {
    const dep = deps[i];
    if (!dep || !dep.from || !dep.to || dep.from === dep.to) continue;
    const fromIt = itemById.get(dep.from);
    const toIt = itemById.get(dep.to);
    if (!fromIt || !toIt || fromIt._hidden || toIt._hidden || !fromIt._bar || !toIt._bar) continue;

    const rawType = String(dep.type || 'fs').toLowerCase();
    const type = (rawType === 'ss' || rawType === 'start-start') ? 'ss' : 'fs';
    const violated = type === 'ss'
      ? Boolean(toIt._start < fromIt._start)
      : Boolean(toIt._start < fromIt._end);

    const fb = fromIt._bar;
    const tb = toIt._bar;
    const fromBothLeft = hasIncomingLeft.has(dep.from) && hasOutgoingSs.has(dep.from);
    const toBothLeft = hasIncomingLeft.has(dep.to) && hasOutgoingSs.has(dep.to);
    const fy = ganttRound1(
      type === 'ss' && fromBothLeft ? fb.y + fb.h * 0.72 : fb.y + fb.h / 2
    );
    const ty = ganttRound1(
      toBothLeft ? tb.y + tb.h * 0.32 : tb.y + tb.h / 2
    );
    let points;

    if (type === 'ss') {
      // 2-bend C-bracket
      const sx = ganttRound1(fb.x);
      const ex = ganttRound1(tb.x);
      const leftX = ganttRound1(Math.min(sx, ex) - 10);
      points = [
        [sx, fy],
        [leftX, fy],
        [leftX, ty],
        [ex, ty]
      ];
    } else {
      const fromRight = ganttRound1(fb.x + fb.w);
      const toLeft = ganttRound1(tb.x);
      const goingDown = ty >= fy;
      const fromIsMilestone = fromIt.kind === 'milestone' && !fromIt._hasChildren;

      const fromEdgeY = fromIsMilestone
        ? ganttRound1(goingDown ? fy + fb.h / 2 : fy - fb.h / 2)
        : ganttRound1(goingDown ? fb.y + fb.h : fb.y);
      const lExitX = fromIsMilestone
        ? ganttRound1(fb.x + fb.w / 2)
        : ganttRound1(
            fb.w <= 12
              ? fb.x + fb.w / 2
              : Math.max(fb.x + 6, Math.min(fromRight - 8, toLeft - 10))
          );

      if (lExitX < toLeft) {
        // 1-bend L-shape exiting bottom/top edge of fromBar (keeps violated dashed styling if overlapping)
        points = [
          [lExitX, fromEdgeY],
          [lExitX, ty],
          [toLeft, ty]
        ];
      } else {
        // Target starts before fromBar's left exit point: compact gutter route
        const exitX = fromIsMilestone
          ? ganttRound1(fb.x + fb.w / 2)
          : ganttRound1(
              fb.w <= 8
                ? fb.x + fb.w / 2
                : Math.max(fb.x + 4, fromRight - 4)
            );
        const gutterY = ganttRound1(goingDown ? fb.y + fb.h + 5 : fb.y - 5);
        const inX = ganttRound1(toLeft - 10);
        points = [
          [exitX, fromEdgeY],
          [exitX, gutterY],
          [inX, gutterY],
          [inX, ty],
          [toLeft, ty]
        ];
      }
    }

    routedDeps.push({
      from: dep.from,
      to: dep.to,
      type,
      violated,
      points,
      path: ganttBuildDepPath(points, DEP_R)
    });
  }
  data._deps = routedDeps;

  // 6. Chart-wide vertical milestone markers
  const routedMarkers = [];
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    if (!m) continue;
    const d = ganttFormatDate(m.date);
    if (!d) continue;
    routedMarkers.push({
      id: m.id || `m_${i}`,
      label: m.label || '',
      date: d,
      x: ganttRound1(dateToX(d) + pxPerDay / 2),
      color: m.color || ''
    });
  }
  data._markers = routedMarkers;

  // 7. Holidays clipped to _range
  const clippedHolidays = [];
  for (let i = 0; i < holidays.length; i++) {
    const h = holidays[i];
    if (!h) continue;
    const hs = ganttFormatDate(h.date || h.start);
    if (!hs) continue;
    const rawEnd = ganttFormatDate(h.end);
    const he = (rawEnd && rawEnd >= hs) ? rawEnd : hs;
    if (he < rangeStart || hs > rangeEnd) continue;
    const cStart = hs < rangeStart ? rangeStart : hs;
    const cEnd = he > rangeEnd ? rangeEnd : he;
    const spanDays = Math.max(1, ganttDiffDays(cStart, cEnd) + 1);
    clippedHolidays.push({
      start: cStart,
      end: cEnd,
      x: ganttRound1(dateToX(cStart)),
      w: ganttRound1(spanDays * pxPerDay),
      name: h.name || '',
      country: h.country || ''
    });
  }
  data._holidays = clippedHolidays;

  // 8. Canvas dimensions
  const headerHeight = GANTT_METRICS.HEADER_H;
  const sidebarWidth = GANTT_METRICS.SIDEBAR_W;
  const visibleRows = Math.max(1, visibleRow);
  data.canvas = {
    width: sidebarWidth + timelineWidth,
    height: headerHeight + visibleRows * ROW_H,
    rowHeight: ROW_H,
    headerHeight,
    sidebarWidth
  };

  return data;
}
//@engine-end
// Mermaid flowchart-family tokenizer, shared by the flowchart and use case importers (plan: dev/plans/plan-mermaid-input.md).
// Plain script: globals only, no DOM, no imports (it is concatenated with the type's mermaid.js).
//
// mmdParseFlow(text) returns the AST described in the plan ("mmdParseFlow(text) result"), with one additive field:
//   dirRaw: the direction word as written in the header ('TD', 'RL', ...) or null, so a caller can say that RL/BT were mapped.
// `ignored` entries are { line, text } with text starting with the statement keyword (style, classDef, click, ...).
// `shape` names: the bracket forms give rect, round, stadium, subroutine, cylinder, circle, dbl-circ, odd, diamond, hex,
// lean-r, lean-l, trap-b, trap-t. `@{ shape: x }` gives the canonical v11 name, with these exceptions where the plan
// gives no name: rectangle aliases -> rect, rounded -> round, pill/terminal -> stadium, hexagon/prepare -> hex,
// decision/question -> diamond, db/database/cylinder -> cyl, framed-rectangle/subprocess/fr-rect -> subproc; any other name
// is passed through lower-cased.
// A node that is only referenced gets shape 'rect' with label = id. The circ shapes (sm-circ, fr-circ, f-circ, dbl-circ)
// get an empty label when none is written.

const MMD_RESERVED = ['end', 'graph', 'subgraph', 'flowchart', 'style', 'class', 'classdef', 'linkstyle', 'click', 'default',
  'direction', 'call', 'href', 'interpolate', 'acctitle', 'accdescr',
  // sequenceDiagram keywords: Mermaid cannot parse them as participant ids, and every type shares one id rule
  'alt', 'else', 'opt', 'loop', 'par', 'and', 'rect', 'box', 'note', 'participant', 'actor', 'create', 'destroy', 'activate',
  'deactivate', 'autonumber', 'title', 'link', 'links', 'properties', 'details', 'critical', 'option', 'break', 'as', 'over', 'left',
  'right', 'of', 'off', 'sequencediagram'];

// Unescape label text: <br> to newline, then entities (#quot; #35; #59; #NNN;). One pass for the entities, so #35;quot; stays text.
function mmdText(s) {
  let t = String(s == null ? '' : s).trim();
  if (/^`[\s\S]*`$/.test(t)) t = t.slice(1, -1);
  t = t.replace(/<br\s*\/?>/gi, '\n');
  const named = { quot: '"', amp: '&', lt: '<', gt: '>', nbsp: ' ' };
  t = t.replace(/#(quot|amp|lt|gt|nbsp|\d+);/g, (m, k) => (k in named ? named[k] : String.fromCodePoint(+k)));
  return t.trim();
}

// Escape and quote a label for Mermaid. An empty label becomes a space, because Mermaid rejects "".
function mmdQuote(s) {
  const map = { '#': '#35;', '"': '#quot;', ';': '#59;', '`': '#96;' };
  const t = String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[#";`]/g, (c) => map[c]).replace(/\n/g, '<br>');
  return '"' + (t === '' ? ' ' : t) + '"';
}

// A Mermaid-safe id. `used` (a Set, optional) makes the result unique and records it.
function mmdSafeId(id, used) {
  let s = String(id == null ? '' : id).replace(/[^A-Za-z0-9_]+/g, '_') || 'n';
  if (/^[0-9]/.test(s)) s = 'n_' + s;
  while (MMD_RESERVED.includes(s.toLowerCase())) s += '_';
  if (used) {
    let u = s, k = 2;
    while (used.has(u)) u = s + '_' + k++;
    used.add(u);
    s = u;
  }
  return s;
}

const MMD_SHAPE_ALIASES = {
  rect: 'rect', rectangle: 'rect', proc: 'rect', process: 'rect', task: 'rect',
  rounded: 'round', event: 'round', stadium: 'stadium', pill: 'stadium', terminal: 'stadium',
  diamond: 'diamond', decision: 'diamond', question: 'diamond',
  doc: 'doc', document: 'doc', delay: 'delay',
  'sm-circ': 'sm-circ', 'small-circle': 'sm-circ', start: 'sm-circ',
  'fr-circ': 'fr-circ', 'framed-circle': 'fr-circ', stop: 'fr-circ',
  'f-circ': 'f-circ', 'filled-circle': 'f-circ', 'dbl-circ': 'dbl-circ', 'double-circle': 'dbl-circ',
  subproc: 'subproc', subprocess: 'subproc', 'fr-rect': 'subproc', 'framed-rectangle': 'subproc',
  cyl: 'cyl', cylinder: 'cyl', db: 'cyl', database: 'cyl', circle: 'circle', circ: 'circle',
  hex: 'hex', hexagon: 'hex', prepare: 'hex', 'lean-r': 'lean-r', 'lean-right': 'lean-r', 'in-out': 'lean-r',
  'lean-l': 'lean-l', 'lean-left': 'lean-l', 'out-in': 'lean-l', 'trap-b': 'trap-b', 'trapezoid-bottom': 'trap-b',
  priority: 'trap-b', 'trap-t': 'trap-t', 'trapezoid-top': 'trap-t', manual: 'trap-t',
};

// Bracket openers, longest first: [opener, family, closers [[closer, shape], ...]]. family = the bracket counted for nesting.
const MMD_OPENERS = [
  ['(((', '(', [[')))', 'dbl-circ']]],
  ['((', '(', [['))', 'circle']]],
  ['([', '(', [['])', 'stadium']]],
  ['(', '(', [[')', 'round']]],
  ['[[', '[', [[']]', 'subroutine']]],
  ['[(', '(', [[')]', 'cylinder']]],
  ['[/', '[', [['/]', 'lean-r'], ['\\]', 'trap-b']]],
  ['[\\', '[', [['\\]', 'lean-l'], ['/]', 'trap-t']]],
  ['[', '[', [[']', 'rect']]],
  ['{{', '{', [['}}', 'hex']]],
  ['{', '{', [['}', 'diamond']]],
  ['>', '[', [[']', 'odd']]],
];
const MMD_CLOSE_OF = { '(': ')', '[': ']', '{': '}' };
const MMD_ID = /[A-Za-z0-9_\u0080-￿]+(?:-(?=[A-Za-z0-9_\u0080-￿])[A-Za-z0-9_\u0080-￿]*)*/y;

// Split a line into statements at `;`, outside quotes and not when the `;` ends an entity such as #59;
function mmdSplitStatements(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    if (c === ';' && !q && !/#\w+$/.test(cur)) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function mmdParseFlow(text) {
  const ast = { title: null, dir: null, dirRaw: null, directives: [], nodes: [], edges: [], subgraphs: [], ignored: [] };
  const nodeById = new Map(), sgById = new Map(), sgOf = new Map(), classOps = [];
  const stack = [];
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  let li = 0, headerSeen = false, ln = 0;
  const fail = (msg) => { throw new Error(`line ${ln}: ${msg}`); };

  // Front-matter
  while (li < lines.length && !lines[li].trim()) li++;
  if (li < lines.length && lines[li].trim() === '---') {
    li++;
    while (li < lines.length && lines[li].trim() !== '---') {
      const m = /^title\s*:\s*(.*)$/.exec(lines[li]);
      if (m) {
        let v = m[1].trim();
        if (v[0] === '"') { try { v = JSON.parse(v); } catch (e) { v = v.replace(/^"|"$/g, ''); } } else if (v[0] === "'") v = v.replace(/^'|'$/g, '');
        ast.title = mmdText(v);
      }
      li++;
    }
    li++;
  }

  function addNode(id, decl, classes) {
    let n = nodeById.get(id);
    if (!n) {
      n = { id, label: id, shape: 'rect', classes: [], line: ln, declared: false };
      nodeById.set(id, n);
      ast.nodes.push(n);
    }
    if (decl && !n.declared) { n.label = decl.label; n.shape = decl.shape; n.declared = true; }
    (classes || []).forEach((c) => { if (!n.classes.includes(c)) n.classes.push(c); });
    if (stack.length && !sgOf.has(id)) {
      const sg = stack[stack.length - 1];
      sgOf.set(id, sg.id);
      sg.nodes.push(id);
    }
    return id;
  }

  // Parse one node (id, then a shape or @{ } block, then :::classes) from s at i. Returns [id, next index].
  function parseNode(s, i) {
    while (s[i] === ' ') i++;
    MMD_ID.lastIndex = i;
    const m = MMD_ID.exec(s);
    if (!m) fail(`cannot read a node id near "${s.slice(i, i + 20)}"`);
    const id = m[0];
    i += id.length;
    let decl = null;
    if (s.startsWith('@{', i)) {
      let j = i + 2, q = false;
      while (j < s.length && (q || s[j] !== '}')) { if (s[j] === '"') q = !q; j++; }
      if (j >= s.length) fail('unterminated @{ }');
      const body = s.slice(i + 2, j);
      i = j + 1;
      const props = {};
      let part = '', pq = false;
      const flush = () => {
        const k = part.indexOf(':');
        if (k > 0) {
          let v = part.slice(k + 1).trim();
          if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
          props[part.slice(0, k).trim().replace(/^"|"$/g, '')] = v;
        }
        part = '';
      };
      for (const c of body) { if (c === '"') pq = !pq; if (c === ',' && !pq) flush(); else part += c; }
      flush();
      const sname = String(props.shape || 'rect').toLowerCase();
      const shape = MMD_SHAPE_ALIASES[sname] || sname;
      const circ = ['sm-circ', 'fr-circ', 'f-circ', 'dbl-circ'].includes(shape);
      decl = { shape, label: 'label' in props ? mmdText(props.label) : (circ ? '' : id) };
    } else {
      for (const [open, fam, closers] of MMD_OPENERS) {
        if (!s.startsWith(open, i)) continue;
        let j = i + open.length;
        while (s[j] === ' ') j++;
        const tryClose = (k) => closers.find(([c]) => s.startsWith(c, k));
        let label = null, hit = null, end = 0;
        if (s[j] === '"') {
          const e = s.indexOf('"', j + 1);
          if (e > 0) {
            let k = e + 1;
            while (s[k] === ' ') k++;
            hit = tryClose(k);
            if (hit) { label = s.slice(j + 1, e); end = k + hit[0].length; }
          }
        }
        if (!hit) {
          const closeCh = MMD_CLOSE_OF[fam];
          let depth = 0, k = j;
          for (; k < s.length; k++) {
            if (depth === 0 && (hit = tryClose(k))) break;
            if (s[k] === fam) depth++; else if (s[k] === closeCh && depth > 0) depth--;
          }
          if (!hit) fail(`missing "${closers[0][0]}" for node ${id}`);
          label = s.slice(j, k);
          end = k + hit[0].length;
        }
        decl = { shape: hit[1], label: mmdText(label) };
        i = end;
        break;
      }
    }
    const classes = [];
    while (s.startsWith(':::', i)) {
      const m2 = /^[\w-]+/.exec(s.slice(i + 3));
      if (!m2) fail('empty class after :::');
      classes.push(m2[0]);
      i += 3 + m2[0].length;
    }
    return [addNode(id, decl, classes), i];
  }

  function parseLink(s, i) {
    let r = s.slice(i), m, id = null;
    if ((m = /^[A-Za-z0-9_]+@(?=[-=.~<ox])/.exec(r))) { id = m[0].slice(0, -1); r = r.slice(m[0].length); }
    let start = '';
    if ((m = /^([<ox])(?=[-=])/.exec(r))) { start = m[1]; r = r.slice(1); }
    let stroke, head = '', label = null;
    const take = (n) => { r = r.slice(n); };
    const textForm = (open, endRe, str) => {
      take(open);
      const e = endRe.exec(r);
      if (!e) fail('unterminated edge text');
      label = r.slice(0, e.index).trim().replace(/^"([\s\S]*)"$/, '$1');
      head = e[0].slice(-1);
      if (!'>ox'.includes(head)) head = '';
      take(e.index + e[0].length);
      stroke = str;
    };
    if ((m = /^~{3,}/.exec(r))) { stroke = 'invisible'; take(m[0].length); } else if (/^==\s/.test(r)) textForm(2, /={2,}[>ox]?/, 'thick');
    else if (/^-\.\s/.test(r)) textForm(2, /\.+-[>ox]?/, 'dotted');
    else if (/^--\s/.test(r)) textForm(2, /-{2,}[>ox]?/, 'normal');
    else if ((m = /^={2,}([>ox]?)/.exec(r))) { stroke = 'thick'; head = m[1]; take(m[0].length); } else if ((m = /^-\.+-([>ox]?)/.exec(r))) { stroke = 'dotted'; head = m[1]; take(m[0].length); } else if ((m = /^-{2,}([>ox]?)/.exec(r))) { stroke = 'normal'; head = m[1]; take(m[0].length); } else return null;
    if ((m = /^\s*\|/.exec(r))) {
      take(m[0].length);
      let e;
      if (/^\s*"/.test(r)) { const q = r.indexOf('"'); const q2 = r.indexOf('"', q + 1); e = r.indexOf('|', q2 + 1); label = r.slice(q + 1, q2); } else { e = r.indexOf('|'); label = r.slice(0, e); }
      if (e < 0) fail('unterminated |edge text|');
      take(e + 1);
    }
    const heads = { '>': 'arrow', o: 'circle', x: 'cross', '': 'none' };
    return { link: { label: label == null ? '' : mmdText(label), stroke, head: heads[head], both: start !== '', id }, next: s.length - r.length };
  }

  function parseChain(s) {
    let i = 0, prev = null;
    for (;;) {
      const group = [];
      for (;;) {
        const [id, j] = parseNode(s, i);
        group.push(id);
        i = j;
        while (s[i] === ' ') i++;
        if (s[i] === '&') { i++; continue; }
        break;
      }
      if (prev) prev.links.forEach((lk) => prev.group.forEach((a) => group.forEach((b) => ast.edges.push({ from: a, to: b, label: lk.label, stroke: lk.stroke, head: lk.head, both: lk.both, line: ln }))));
      if (i >= s.length) return;
      const res = parseLink(s, i);
      if (!res) fail(`cannot read "${s.slice(i, i + 20)}"`);
      i = res.next;
      prev = { group, links: [res.link] };
    }
  }

  // A repeated id under another parent is a separate subgraph (the same lane inside a `sub_` block); `sub` names the
  // top-level `sub_` block a subgraph sits in (flowcharts), else null.
  const sgScoped = new Map();
  function parseSubgraph(rest) {
    let id, title, m;
    if ((m = /^([^\s\[\]"]+)\s*\[([\s\S]*)\]$/.exec(rest))) { id = m[1]; title = m[2].trim().replace(/^"([\s\S]*)"$/, '$1'); } else if ((m = /^"([\s\S]*)"$/.exec(rest))) { id = title = m[1]; } else { id = title = rest; }
    title = mmdText(title);
    const top = stack.length ? stack[stack.length - 1] : null, parent = top ? top.id : null;
    const key = parent + '>' + id;
    const known = sgScoped.get(key) || (sgById.has(id) && sgById.get(id).parent === parent ? sgById.get(id) : null);
    if (known) { stack.push(known); return; }
    const sg = { id, title, parent, sub: !top && /^sub_/.test(id) ? id : (top ? top.sub : null), nodes: [], classes: [], line: ln };
    sgScoped.set(key, sg);
    if (!sgById.has(id)) sgById.set(id, sg);
    ast.subgraphs.push(sg);
    stack.push(sg);
  }

  function statement(s) {
    let m;
    if ((m = /^subgraph(?:\s+([\s\S]*))?$/.exec(s))) return parseSubgraph((m[1] || '').trim());
    if (s === 'end') { stack.pop(); return; }
    if (/^direction\s+\w+$/.test(s)) return;
    if ((m = /^class\s+(\S+)\s+(\S+)$/.exec(s))) { classOps.push([m[1].split(','), m[2].split(',')]); return; }
    if ((m = /^(classDef|style|linkStyle|click|accTitle|accDescr|href|call)\b/.exec(s))) { ast.ignored.push({ line: ln, text: s }); return; }
    parseChain(s);
  }

  let inAcc = false;
  for (; li < lines.length; li++) {
    ln = li + 1;
    const raw = lines[li].trim();
    if (inAcc) { if (raw.includes('}')) inAcc = false; continue; }
    if (!raw) continue;
    if (raw.startsWith('%%')) {
      const m = /^%%\s*@(\w+)\s*(.*)$/.exec(raw);
      if (m) ast.directives.push({ key: m[1], args: m[2].trim(), line: ln });
      continue;
    }
    if (/^accDescr\s*\{/.test(raw) && !raw.includes('}')) { inAcc = true; ast.ignored.push({ line: ln, text: raw }); continue; }
    let stmts = mmdSplitStatements(raw);
    if (!headerSeen) {
      const m = /^(?:flowchart|graph)(?:-elk)?(?:\s+(LR|RL|TB|TD|BT))?\s*(.*)$/.exec(stmts[0]);
      if (!m) fail('expected "flowchart" or "graph"');
      headerSeen = true;
      if (m[1]) { ast.dirRaw = m[1]; ast.dir = { LR: 'LR', RL: 'LR', TB: 'TB', TD: 'TB', BT: 'TB' }[m[1]]; }
      stmts = (m[2] ? [m[2]] : []).concat(stmts.slice(1));
    }
    stmts.forEach(statement);
  }
  if (!headerSeen) { ln = 1; fail('expected "flowchart" or "graph"'); }

  classOps.forEach(([ids, cls]) => ids.forEach((id) => {
    const target = nodeById.get(id) || sgById.get(id);
    if (target) cls.forEach((c) => { if (!target.classes.includes(c)) target.classes.push(c); });
  }));
  ast.nodes.forEach((n) => delete n.declared);
  return ast;
}
// Gantt diagram <-> Mermaid. Plain script, no DOM, no imports; concatenated after assets/shell/mermaid-flow.js
// (uses mmdText, mmdSafeId). Spec: dev/plans/plan-gantt.md.

const MMD_GANTT_ZOOMS = ['day', 'week', 'month', 'quarter', 'year'];
const MMD_GANTT_TAGS = new Set(['done', 'active', 'crit', 'milestone', 'vert']);
const MMD_GANTT_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MMD_GANTT_COLOR_RE = /^(?:[1-9]|#[0-9a-f]{3,8})$/i;
const MMD_GANTT_DEP_TYPES = { fs: 'fs', 'finish-start': 'fs', ss: 'ss', 'start-start': 'ss' };
const MMD_GANTT_KEYS = [
  'diagramType', 'schemaVersion', 'title', 'zoom', 'showNotes', 'showToday',
  'colorKey', 'holidays', 'markers', 'items', 'dependencies', 'notes', '_holidaysMode',
];

// Deterministic UTC calendar date math (epoch days integer; no local timezone drift, no Date.now()).
function mmdGanttParseDate(s) {
  const m = MMD_GANTT_DATE_RE.exec(String(s == null ? '' : s).trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return Math.floor(ms / 86400000);
}

function mmdGanttFormatDate(dayNum) {
  const dt = new Date(dayNum * 86400000);
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function mmdGanttAddDays(iso, delta) {
  const day = mmdGanttParseDate(iso);
  if (day === null) return null;
  return mmdGanttFormatDate(day + delta);
}

function mmdGanttParseDuration(token) {
  const m = /^(\d+)\s*([dwh])$/i.exec(String(token == null ? '' : token).trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'd') return n;
  if (unit === 'w') return n * 7;
  return n === 0 ? 0 : Math.max(1, Math.ceil(n / 24));
}

function mmdGanttSlug(label, used, prefix) {
  let s = String(label == null ? '' : label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!s) s = prefix || 'item';
  else if (/^[0-9]/.test(s)) s = (prefix || 's') + '_' + s;
  else if (prefix) s = prefix + '_' + s;
  return mmdSafeId(s, used);
}

function mmdGanttEscNote(s) {
  return String(s == null ? '' : s)
    .replace(/\r\n?/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n');
}

function mmdGanttUnescNote(s) {
  return String(s == null ? '' : s).replace(/\\([\\n])/g, (_, c) => (c === 'n' ? '\n' : '\\'));
}

function mmdGanttEscLabel(s) {
  return String(s == null ? '' : s)
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, ' ')
    .replace(/:/g, '#58;')
    .trim();
}

function fromMermaid(text, opts) {
  opts = opts || {};
  const infos = [], warnings = [];
  const info = (s) => infos.push('[INFO] ' + s);
  const warn = (s) => warnings.push('[WARN] ' + s);
  const once = new Set();
  const infoOnce = (key, s) => { if (!once.has(key)) { once.add(key); info(s); } };

  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  let li = 0, ln = 0, headerSeen = false;
  let title = null, schemaVersion = 1, zoom = 'month', showNotes = false, showToday = true;
  let holidaysMode = null;

  // Optional YAML front-matter
  while (li < lines.length && !lines[li].trim()) li++;
  if (li < lines.length && lines[li].trim() === '---') {
    li++;
    while (li < lines.length && lines[li].trim() !== '---') {
      const fm = /^title\s*:\s*(.*)$/.exec(lines[li]);
      if (fm) {
        let v = fm[1].trim();
        if (v[0] === '"') { try { v = JSON.parse(v); } catch (e) { v = v.replace(/^"|"$/g, ''); } }
        else if (v[0] === "'") v = v.replace(/^'|'$/g, '');
        title = mmdText(v);
      }
      li++;
    }
    li++;
  }

  const colorKey = {};
  const holidays = [], holidaySeen = new Set();
  const markers = [], markerIds = new Set();
  const items = [], itemById = new Map(), usedIds = new Set();
  const dependencies = [], depSeen = new Set();
  const notes = [];
  const deferred = []; // directives that reference item IDs, applied after all items are parsed

  let currentSectionId = null;
  let lastTaskEnd = null;
  let pendingSectionId = null;

  function addHoliday(date, end, name, country) {
    const k = date + '|' + end + '|' + name;
    if (holidaySeen.has(k)) return;
    holidaySeen.add(k);
    const h = { date, end, name };
    if (country) h.country = country;
    holidays.push(h);
  }

  function addDep(from, to, type) {
    const k = from + '|' + to + '|' + type;
    if (depSeen.has(k)) return;
    depSeen.add(k);
    dependencies.push({ from, to, type });
  }

  function parseDirective(key, args, line) {
    let m;
    switch (key) {
      case 'schemaVersion': {
        const n = Number(args);
        if (args !== '' && Number.isInteger(n) && n >= 1) schemaVersion = n;
        else warn('line ' + line + ': @schemaVersion needs a positive integer, ignored');
        break;
      }
      case 'zoom': {
        const z = args.toLowerCase();
        if (MMD_GANTT_ZOOMS.includes(z)) zoom = z;
        else warn('line ' + line + ': invalid @zoom "' + args + '", ignored');
        break;
      }
      case 'showNotes':
        showNotes = /^false$/i.test(args) ? false : true;
        break;
      case 'showToday':
        showToday = /^false$/i.test(args) ? false : true;
        break;
      case 'holidays': {
        const low = args.toLowerCase();
        if (low === 'auto' || low === 'none') {
          holidaysMode = low;
        } else {
          const codes = args.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
          if (codes.length && codes.every((c) => /^[A-Z]{2}$/.test(c))) holidaysMode = codes.join(',');
          else warn('line ' + line + ': invalid @holidays "' + args + '", expected auto, none, or country codes');
        }
        break;
      }
      case 'holiday': {
        m = /^(\d{4}-\d{2}-\d{2})(?:\.\.(\d{4}-\d{2}-\d{2}))?(?:\s+([\s\S]+))?$/.exec(args);
        if (!m) { warn('line ' + line + ': invalid @holiday "' + args + '"'); break; }
        const sDay = mmdGanttParseDate(m[1]);
        const eIso = m[2] || m[1];
        const eDay = mmdGanttParseDate(eIso);
        if (sDay === null || eDay === null) { warn('line ' + line + ': invalid date in @holiday "' + args + '"'); break; }
        if (eDay < sDay) { warn('line ' + line + ': @holiday end date is before start date'); break; }
        let rawName = (m[3] || 'Holiday').trim();
        let country = '';
        const cm = /^(.*?)\s+\[([A-Z]{2})\]$/.exec(rawName);
        if (cm) { rawName = cm[1].trim(); country = cm[2]; }
        addHoliday(m[1], eIso, mmdText(rawName) || 'Holiday', country);
        break;
      }
      case 'colorKey': {
        if (/^[1-9]\s*:/.test(args)) {
          const entries = args.split(/,\s*(?=[1-9]\s*:)/);
          entries.forEach((entry) => {
            const em = /^([1-9])\s*:\s*([\s\S]+)$/.exec(entry.trim());
            if (em) colorKey[em[1]] = mmdText(em[2]);
            else warn('line ' + line + ': invalid @colorKey entry "' + entry.trim() + '"');
          });
        } else if ((m = /^([1-9])\s+([\s\S]+)$/.exec(args))) {
          colorKey[m[1]] = mmdText(m[2]);
        } else {
          warn('line ' + line + ': invalid @colorKey "' + args + '"');
        }
        break;
      }
      case 'marker': {
        m = /^([\s\S]+?)\s*:\s*(\d{4}-\d{2}-\d{2})(?:\s+(\S+))?$/.exec(args);
        if (!m) { warn('line ' + line + ': invalid @marker "' + args + '"'); break; }
        if (mmdGanttParseDate(m[2]) === null) { warn('line ' + line + ': invalid date in @marker "' + m[2] + '"'); break; }
        const label = mmdText(m[1]);
        const mk = { id: mmdGanttSlug(label, markerIds, 'm'), label, date: m[2] };
        if (m[3]) {
          if (MMD_GANTT_COLOR_RE.test(m[3])) mk.color = m[3];
          else warn('line ' + line + ': invalid color "' + m[3] + '" in @marker, ignored');
        }
        markers.push(mk);
        break;
      }
      case 'id': {
        if (/^\S+$/.test(args)) pendingSectionId = args;
        else warn('line ' + line + ': @id needs a single identifier, ignored');
        break;
      }
      case 'parent':
      case 'dep':
      case 'color':
      case 'collapsed':
      case 'note':
        deferred.push({ key, args, line });
        break;
      case 'progress':
      case 'type':
        break;
      default:
        info('line ' + line + ': unknown directive @' + key + ' ignored');
    }
  }

  function parseTaskLine(lineStr) {
    const colonIdx = lineStr.lastIndexOf(':');
    if (colonIdx <= 0) { warn('line ' + ln + ': not understood, skipped: ' + lineStr); return; }
    const label = mmdText(lineStr.slice(0, colonIdx));
    const meta = lineStr.slice(colonIdx + 1);
    const tokens = meta.split(',').map((s) => s.trim()).filter(Boolean);
    if (!tokens.length) { warn('line ' + ln + ': missing task dates for "' + label + '"'); return; }

    const tags = new Set();
    let idx = 0;
    while (idx < tokens.length && MMD_GANTT_TAGS.has(tokens[idx].toLowerCase())) {
      tags.add(tokens[idx].toLowerCase());
      idx++;
    }
    const rest = tokens.slice(idx);
    if (!rest.length || rest.length > 3) {
      warn('line ' + ln + ': cannot parse task metadata for "' + label + '"');
      return;
    }

    const isDate = (t) => MMD_GANTT_DATE_RE.test(t);
    const isAfter = (t) => /^after\s+\S+/i.test(t);
    const isDur = (t) => mmdGanttParseDuration(t) !== null;

    let rawId = null, startSpec = null, endSpec = null;
    if (rest.length === 3) {
      rawId = rest[0];
      startSpec = rest[1];
      endSpec = rest[2];
    } else if (rest.length === 2) {
      if (isDate(rest[0]) || isAfter(rest[0])) {
        startSpec = rest[0];
        endSpec = rest[1];
      } else {
        rawId = rest[0];
        startSpec = rest[1];
        endSpec = null;
      }
    } else {
      if (isDate(rest[0]) || isAfter(rest[0])) {
        startSpec = rest[0];
        endSpec = null;
      } else if (isDur(rest[0])) {
        startSpec = null;
        endSpec = rest[0];
      } else {
        warn('line ' + ln + ': cannot parse task "' + label + '"');
        return;
      }
    }

    let id;
    if (rawId) {
      if (itemById.has(rawId)) {
        warn('line ' + ln + ': duplicate id "' + rawId + '"');
        id = mmdSafeId(rawId, usedIds);
      } else {
        id = rawId;
        usedIds.add(id);
      }
    } else {
      id = mmdGanttSlug(label, usedIds);
    }

    // Resolve start
    let start = null;
    const afterRefs = [];
    if (startSpec === null) {
      if (lastTaskEnd) start = lastTaskEnd;
      else { warn('line ' + ln + ': duration-only task "' + label + '" has no previous task to follow'); return; }
    } else if (isAfter(startSpec)) {
      const refIds = startSpec.replace(/^after\s+/i, '').trim().split(/\s+/).filter(Boolean);
      let latestDay = null;
      refIds.forEach((refId) => {
        const ref = itemById.get(refId);
        if (!ref) {
          warn('line ' + ln + ': unknown task "' + refId + '" in "after"');
          return;
        }
        afterRefs.push(refId);
        const refEnd = ref.end || ref.start;
        const d = refEnd ? mmdGanttParseDate(refEnd) : null;
        if (d !== null && (latestDay === null || d > latestDay)) latestDay = d;
      });
      if (latestDay === null) {
        warn('line ' + ln + ': could not resolve start date from "' + startSpec + '"');
        return;
      }
      start = mmdGanttFormatDate(latestDay);
    } else if (isDate(startSpec)) {
      if (mmdGanttParseDate(startSpec) === null) {
        warn('line ' + ln + ': invalid start date "' + startSpec + '" for "' + label + '"');
        return;
      }
      start = startSpec;
    } else {
      warn('line ' + ln + ': invalid start "' + startSpec + '" for "' + label + '"');
      return;
    }

    // Resolve kind and end
    const isMilestone = tags.has('milestone');
    let end = start;
    if (!isMilestone) {
      if (endSpec === null) {
        end = start;
      } else if (isDate(endSpec)) {
        const sDay = mmdGanttParseDate(start);
        const eDay = mmdGanttParseDate(endSpec);
        if (eDay === null) {
          warn('line ' + ln + ': invalid end date "' + endSpec + '" for "' + label + '"');
          return;
        }
        if (eDay < sDay) warn('line ' + ln + ': end date "' + endSpec + '" is before start date "' + start + '" for "' + label + '"');
        end = endSpec;
      } else if (isDur(endSpec)) {
        const days = mmdGanttParseDuration(endSpec);
        end = mmdGanttAddDays(start, days);
      } else {
        warn('line ' + ln + ': invalid end or duration "' + endSpec + '" for "' + label + '"');
        return;
      }
    }

    const item = {
      id,
      kind: isMilestone ? 'milestone' : 'task',
      label,
    };
    if (currentSectionId) item.parent = currentSectionId;
    item.start = start;
    item.end = end;

    items.push(item);
    itemById.set(id, item);
    lastTaskEnd = end;
    afterRefs.forEach((refId) => addDep(refId, id, 'fs'));
  }

  for (; li < lines.length; li++) {
    ln = li + 1;
    const raw = lines[li].trim();
    if (!raw) continue;
    if (raw.startsWith('%%')) {
      const dm = /^%%\s*@(\w+)(?:\s+([\s\S]*))?$/.exec(raw);
      if (dm) parseDirective(dm[1], (dm[2] || '').trim(), ln);
      continue;
    }
    if (!headerSeen) {
      if (!/^gantt\b/i.test(raw)) throw new Error('line ' + ln + ': expected "gantt"');
      headerSeen = true;
      continue;
    }

    let m;
    if ((m = /^title(?:\s*:\s*|\s+)([\s\S]+)$/i.exec(raw))) {
      title = mmdText(m[1]);
    } else if ((m = /^dateFormat\s+(\S+)$/i.exec(raw))) {
      if (m[1].toUpperCase() !== 'YYYY-MM-DD') {
        infoOnce('datefmt', 'dateFormat "' + m[1] + '" is not YYYY-MM-DD; dates are parsed as YYYY-MM-DD');
      }
    } else if ((m = /^excludes\s+([\s\S]+)$/i.exec(raw))) {
      m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((tok) => {
        if (MMD_GANTT_DATE_RE.test(tok)) {
          if (mmdGanttParseDate(tok) !== null) addHoliday(tok, tok, 'Excluded', '');
          else warn('line ' + ln + ': invalid date "' + tok + '" in excludes');
        } else {
          infoOnce('excludes-kw', 'non-date excludes ("' + tok + '") are not skipped in duration math; weekends are shaded visually');
        }
      });
    } else if ((m = /^section\s+([\s\S]+)$/i.exec(raw))) {
      const label = mmdText(m[1]);
      let secId;
      if (pendingSectionId) {
        if (itemById.has(pendingSectionId)) {
          warn('line ' + ln + ': duplicate id "' + pendingSectionId + '"');
          secId = mmdSafeId(pendingSectionId, usedIds);
        } else {
          secId = pendingSectionId;
          usedIds.add(secId);
        }
        pendingSectionId = null;
      } else {
        secId = mmdGanttSlug(label, usedIds);
      }
      const grp = { id: secId, kind: 'group', label };
      items.push(grp);
      itemById.set(secId, grp);
      currentSectionId = secId;
    } else if (/^(axisFormat|tickInterval|todayMarker|weekday|weekend|includes|accTitle|accDescr|click)\b/i.test(raw)) {
      const kw = raw.split(/[\s:]/)[0];
      infoOnce('ign-' + kw.toLowerCase(), '"' + kw + '" is not used by gantt diagrams, ignored');
    } else if (raw.includes(':')) {
      pendingSectionId = null;
      parseTaskLine(raw);
    } else {
      warn('line ' + ln + ': not understood, skipped: ' + raw);
    }
  }

  if (!headerSeen) throw new Error('line 1: expected "gantt"');

  // Apply deferred item-level directives now that all items exist
  deferred.forEach((d) => {
    const a = d.args;
    let m;
    switch (d.key) {
      case 'parent': {
        m = /^(\S+)\s+(\S+)$/.exec(a);
        if (!m) { warn('line ' + d.line + ': @parent needs <id> <parentId>'); break; }
        const child = itemById.get(m[1]);
        if (!child) { warn('line ' + d.line + ': unknown item "' + m[1] + '" in @parent'); break; }
        if (m[2].toLowerCase() === 'none' || m[2].toLowerCase() === 'root') {
          delete child.parent;
        } else if (m[1] === m[2]) {
          warn('line ' + d.line + ': item "' + m[1] + '" cannot be its own parent');
        } else if (!itemById.has(m[2])) {
          warn('line ' + d.line + ': unknown parent "' + m[2] + '" in @parent');
        } else {
          child.parent = m[2];
        }
        break;
      }
      case 'dep': {
        m = /^(\S+)\s+(\S+)\s+(\S+)$/.exec(a);
        if (!m) { warn('line ' + d.line + ': @dep needs <toId> <fs|ss|finish-start|start-start> <fromId>'); break; }
        const toId = m[1], rawType = m[2].toLowerCase(), fromId = m[3];
        const depType = MMD_GANTT_DEP_TYPES[rawType];
        if (!depType) { warn('line ' + d.line + ': invalid dependency type "' + m[2] + '" in @dep'); break; }
        if (!itemById.has(toId)) { warn('line ' + d.line + ': unknown target "' + toId + '" in @dep'); break; }
        if (!itemById.has(fromId)) { warn('line ' + d.line + ': unknown source "' + fromId + '" in @dep'); break; }
        if (fromId === toId) { warn('line ' + d.line + ': self-dependency on "' + fromId + '" ignored'); break; }
        addDep(fromId, toId, depType);
        break;
      }
      case 'color': {
        m = /^(\S+)\s+(\S+)$/.exec(a);
        if (!m) { warn('line ' + d.line + ': @color needs <id> <1..9|#hex>'); break; }
        const it = itemById.get(m[1]);
        if (!it) { warn('line ' + d.line + ': unknown item "' + m[1] + '" in @color'); break; }
        if (!MMD_GANTT_COLOR_RE.test(m[2])) { warn('line ' + d.line + ': invalid color "' + m[2] + '" in @color'); break; }
        it.color = m[2];
        break;
      }
      case 'collapsed': {
        m = /^(\S+)(?:\s+(\S+))?$/.exec(a);
        if (!m) { warn('line ' + d.line + ': @collapsed needs <id>'); break; }
        const it = itemById.get(m[1]);
        if (!it) { warn('line ' + d.line + ': unknown item "' + m[1] + '" in @collapsed'); break; }
        if (m[2] && /^false$/i.test(m[2])) delete it.collapsed;
        else it.collapsed = true;
        break;
      }
      case 'note': {
        m = /^(\S+)\s+([\s\S]+)$/.exec(a);
        if (!m) { warn('line ' + d.line + ': @note needs <id> <text>'); break; }
        if (!itemById.has(m[1])) { warn('line ' + d.line + ': unknown item "' + m[1] + '" in @note'); break; }
        notes.push({ id: 'n' + (notes.length + 1), text: mmdGanttUnescNote(m[2]), target: m[1] });
        break;
      }
    }
  });

  if (!items.some((it) => it.kind === 'task' || it.kind === 'milestone')) {
    warn('the chart has no tasks or milestones');
  }

  const rawData = {
    diagramType: 'gantt',
    schemaVersion,
    zoom,
    showNotes,
    showToday,
    items,
    dependencies,
  };
  if (title !== null) rawData.title = title;
  if (Object.keys(colorKey).length) rawData.colorKey = colorKey;
  if (holidays.length) rawData.holidays = holidays;
  if (markers.length) rawData.markers = markers;
  if (notes.length) rawData.notes = notes;
  if (holidaysMode !== null) rawData._holidaysMode = holidaysMode;

  const data = {};
  MMD_GANTT_KEYS.forEach((k) => { if (k in rawData) data[k] = rawData[k]; });
  return { data, infos, warnings };
}

function toMermaid(data, opts) {
  opts = opts || {};
  const d = data || {};
  const items = Array.isArray(d.items) ? d.items : [];
  const deps = Array.isArray(d.dependencies) ? d.dependencies : [];
  const holidays = Array.isArray(d.holidays) ? d.holidays : [];
  const markers = Array.isArray(d.markers) ? d.markers : [];
  const notes = Array.isArray(d.notes) ? d.notes : [];
  const ck = d.colorKey && typeof d.colorKey === 'object' ? d.colorKey : {};

  // Assign safe unique IDs for all items
  const used = new Set(), idMap = new Map();
  items.forEach((it) => {
    if (!it || it.id == null) return;
    const raw = String(it.id);
    if (!idMap.has(raw)) idMap.set(raw, mmdSafeId(raw, used));
  });
  const sid = (id) => idMap.get(String(id)) || mmdSafeId(String(id));

  // Precompute fallback rolled-up date bounds for parent tasks that lack explicit start/end
  const childrenOf = new Map();
  items.forEach((it) => {
    if (it && it.parent) {
      if (!childrenOf.has(it.parent)) childrenOf.set(it.parent, []);
      childrenOf.get(it.parent).push(it);
    }
  });
  function effectiveDates(it, seen) {
    if (it.start && it.end) return [it.start, it.end];
    const vis = seen || new Set();
    if (vis.has(it.id)) return [null, null];
    vis.add(it.id);
    let minD = null, maxD = null;
    (childrenOf.get(it.id) || []).forEach((ch) => {
      const [cs, ce] = effectiveDates(ch, vis);
      const sd = cs ? mmdGanttParseDate(cs) : null;
      const ed = ce ? mmdGanttParseDate(ce) : null;
      if (sd !== null && (minD === null || sd < minD)) minD = sd;
      if (ed !== null && (maxD === null || ed > maxD)) maxD = ed;
    });
    if (minD !== null && maxD !== null) return [mmdGanttFormatDate(minD), mmdGanttFormatDate(maxD)];
    return [it.start || null, it.end || it.start || null];
  }

  // Index notes by target so directives sit cleanly under their item
  const notesByTarget = new Map();
  const emittedNotes = new Set();
  notes.forEach((n, i) => {
    if (!n || !n.target) return;
    if (!notesByTarget.has(n.target)) notesByTarget.set(n.target, []);
    notesByTarget.get(n.target).push({ n, i });
  });

  const out = ['gantt'];
  const ind = '    ';
  if (d.title) out.push(ind + 'title ' + String(d.title).replace(/\r\n?/g, '\n').replace(/\n/g, ' ').trim());
  out.push(ind + 'dateFormat YYYY-MM-DD');
  if (d.schemaVersion != null && d.schemaVersion !== 1) out.push(ind + '%% @schemaVersion ' + d.schemaVersion);
  if (d.zoom && MMD_GANTT_ZOOMS.includes(String(d.zoom).toLowerCase())) out.push(ind + '%% @zoom ' + String(d.zoom).toLowerCase());
  if (d.showNotes === true) out.push(ind + '%% @showNotes true');
  if (d.showToday === false) out.push(ind + '%% @showToday false');
  if (d._holidaysMode) out.push(ind + '%% @holidays ' + d._holidaysMode);

  const ckKeys = Object.keys(ck).filter((k) => /^[1-9]$/.test(k) && ck[k] != null && String(ck[k]).trim() !== '')
    .sort((a, b) => Number(a) - Number(b));
  if (ckKeys.length) {
    out.push(ind + '%% @colorKey ' + ckKeys.map((k) => k + ': ' + String(ck[k]).replace(/\r\n?/g, '\n').replace(/\n/g, ' ').trim()).join(', '));
  }

  holidays.forEach((h) => {
    if (!h || !h.date) return;
    const span = h.end && h.end !== h.date ? h.date + '..' + h.end : h.date;
    const name = String(h.name || 'Holiday').replace(/\r\n?/g, '\n').replace(/\n/g, ' ').trim();
    const cc = h.country && /^[A-Z]{2}$/.test(h.country) ? ' [' + h.country + ']' : '';
    out.push(ind + '%% @holiday ' + span + ' ' + name + cc);
  });

  markers.forEach((mk) => {
    if (!mk || !mk.label || !mk.date) return;
    const label = String(mk.label).replace(/\r\n?/g, '\n').replace(/\n/g, ' ').trim();
    const col = mk.color != null && mk.color !== '' ? ' ' + mk.color : '';
    out.push(ind + '%% @marker ' + label + ' : ' + mk.date + col);
  });

  // Track slugs as fromMermaid would assign them to know when a section needs `%% @id`
  const simUsed = new Set();
  let currentSectionId = null;

  items.forEach((it) => {
    if (!it || it.id == null) return;
    const id = sid(it.id);

    if (it.kind === 'group') {
      out.push('');
      const autoSlug = mmdGanttSlug(it.label || '', new Set(simUsed));
      if (id !== autoSlug) out.push(ind + '%% @id ' + id);
      simUsed.add(id);
      out.push(ind + 'section ' + String(it.label || id).replace(/\r\n?/g, '\n').replace(/\n/g, ' ').trim());
      currentSectionId = it.id;
      if (it.parent) out.push(ind + '%% @parent ' + id + ' ' + sid(it.parent));
      if (it.color != null && it.color !== '') out.push(ind + '%% @color ' + id + ' ' + it.color);
      if (it.collapsed === true) out.push(ind + '%% @collapsed ' + id);
    } else {
      simUsed.add(id);
      const label = mmdGanttEscLabel(it.label || id);
      const [start, end] = effectiveDates(it);
      if (it.kind === 'milestone') {
        out.push(ind + label + ' :milestone, ' + id + ', ' + (start || '2026-01-01') + ', 0d');
      } else {
        out.push(ind + label + ' :' + id + ', ' + (start || '2026-01-01') + ', ' + (end || start || '2026-01-01'));
      }
      if (it.parent && it.parent !== currentSectionId) {
        out.push(ind + '%% @parent ' + id + ' ' + sid(it.parent));
      } else if (!it.parent && currentSectionId !== null) {
        out.push(ind + '%% @parent ' + id + ' none');
      }
      if (it.color != null && it.color !== '') out.push(ind + '%% @color ' + id + ' ' + it.color);
      if (it.collapsed === true) out.push(ind + '%% @collapsed ' + id);
    }

    (notesByTarget.get(it.id) || []).forEach(({ n, i }) => {
      emittedNotes.add(i);
      out.push(ind + '%% @note ' + sid(n.target) + ' ' + mmdGanttEscNote(n.text));
    });
  });

  // Emit dependencies in exact array order so round-trips preserve order
  const validDeps = deps.filter((dep) => dep && dep.from && dep.to);
  if (validDeps.length) {
    out.push('');
    validDeps.forEach((dep) => {
      const t = dep.type === 'ss' ? 'ss' : 'fs';
      out.push(ind + '%% @dep ' + sid(dep.to) + ' ' + t + ' ' + sid(dep.from));
    });
  }
  notes.forEach((n, i) => {
    if (emittedNotes.has(i) || !n || !n.target) return;
    out.push(ind + '%% @note ' + sid(n.target) + ' ' + mmdGanttEscNote(n.text));
  });

  return out.join('\n') + '\n';
}
// --- GANTT DIAGRAM PLUGIN ---
// Renders chartData (diagramType "gantt") laid out by assets/types/gantt/engine.js.
// Split-pane workspace: resizable left task tree + scrollable right calendar timeline with sticky two-tier header.
// Reuses GANTT_ZOOMS, GANTT_METRICS, ganttParseDate, ganttFormatDate, ganttAddDays, ganttDiffDays from engine.js (SSOT).
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const ZOOM_ORDER = ['day', 'week', 'month', 'quarter', 'year'];
  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const LABEL_MAX = 120;
  const SIDEBAR_MIN = 180;
  const SIDEBAR_MAX = 480;

  // --- DOM REFERENCES ---
  const root = document.getElementById('gantt-root');
  const sidebar = document.getElementById('gantt-sidebar');
  const treeEl = document.getElementById('gantt-tree');
  const splitter = document.getElementById('gantt-splitter');
  const timeline = document.getElementById('gantt-timeline');
  const headerEl = document.getElementById('gantt-header');
  const headerTop = document.getElementById('gantt-header-top');
  const headerBottom = document.getElementById('gantt-header-bottom');
  const headerMarkers = document.getElementById('gantt-header-markers');
  const bodyEl = document.getElementById('gantt-body');
  const gridEl = document.getElementById('gantt-grid');
  const markersEl = document.getElementById('gantt-markers');
  const todayEl = document.getElementById('gantt-today');
  const depsEl = document.getElementById('gantt-deps');
  const barsEl = document.getElementById('gantt-bars');
  const marqueeEl = document.getElementById('gantt-marquee');
  const notesEl = document.getElementById('gantt-notes');
  const dragTipEl = document.getElementById('gantt-drag-tip');
  const legendWrap = document.getElementById('gantt-legend-wrap');
  const colorKeyHost = document.getElementById('gantt-color-key');
  const btnLegend = document.getElementById('btn-legend');

  const btnAdd = document.getElementById('btn-add');
  const addPop = document.getElementById('gantt-add-pop');
  const btnAddTask = document.getElementById('btn-add-task');
  const btnAddSubtask = document.getElementById('btn-add-subtask');
  const btnAddMilestone = document.getElementById('btn-add-milestone');
  const btnAddMarker = document.getElementById('btn-add-marker');
  const btnAddNote = document.getElementById('btn-add-note');
  const btnAddInline = document.getElementById('btn-add-inline');
  const btnToggleAll = document.getElementById('btn-toggle-all');
  const btnNotes = document.getElementById('btn-notes');
  const btnDeps = document.getElementById('btn-deps');
  const btnWeekends = document.getElementById('btn-weekends');
  const btnToday = document.getElementById('btn-today');
  const btnHolidays = document.getElementById('btn-holidays');
  const holidaysPop = document.getElementById('gantt-holidays-pop');
  const holidaysList = document.getElementById('gantt-holidays-list');
  const holDateInput = document.getElementById('gantt-hol-date');
  const holEndInput = document.getElementById('gantt-hol-end');
  const holNameInput = document.getElementById('gantt-hol-name');
  const holAddBtn = document.getElementById('gantt-hol-add');
  const holCloseBtn = document.getElementById('gantt-hol-close');
  const zoomPills = document.getElementById('gantt-zoom-pills');

  const EXTEND_DAYS = { day: 90, week: 180, month: 180, quarter: 365, year: 365 };

  // --- STATE ---
  let selItems = new Set();        // selected item IDs (tasks, groups, milestones)
  let lastSelItemId = null;        // anchor for Shift+click range selection
  let selMarkerId = null;          // selected chart-wide vertical marker ID
  let selDepKey = null;            // selected dependency key `${from}|${to}|${type}`
  let selNoteId = null;            // selected note ID
  let editingNoteId = null;        // note currently open for typing
  let noteDraft = null;            // { id, isNew, wasOn, before }
  let peekNoteItemId = null;       // item ID whose note is being peeked on hover/click
  let hoveredItemId = null;        // item ID currently hovered for dependency chain spotlight
  let hoveredRowId = null;         // item ID currently hovered for synchronized row highlight
  let showDeps = true;             // whether dependency arrows layer is visible
  let legendOpen = false;          // whether #gantt-color-key popover is open (closed by default)
  let legendPinned = false;        // whether legend was explicitly pinned open via click/keyboard
  let connectState = null;         // { fromId, type: 'fs' | 'ss', pointerDrag?: boolean }
  let activeDrag = null;           // active bar/resize/marker/marquee/splitter/row drag state
  let actionBarEl = null;          // floating ui.actionBar element
  let floatingPop = null;          // active sub-popover (dates, shift, etc.)
  let sidebarWidth = GANTT_METRICS.SIDEBAR_W;
  let renderedDepsSvg = null;      // SVG element inside or equal to #gantt-deps
  let isSyncingScroll = false;
  let didInitialScroll = false;
  let isExtendingTimeline = false;
  let ghostBarEl = null;
  let ghostRowId = null;

  const els = {
    rows: new Map(),               // itemId -> sidebar row element
    rowBgs: new Map(),             // itemId -> timeline row background element
    bars: new Map(),               // itemId -> bar/milestone element
    markers: new Map(),            // markerId -> { line, flag }
    deps: new Map(),               // depKey -> { g, path, hit }
    notes: new Map()               // noteId -> note card element
  };

  // --- MODEL HELPERS ---
  const presenting = () => document.body.classList.contains('presentation');
  const itemsList = () => (Array.isArray(chartData.items) ? chartData.items : []);
  const depsList = () => (Array.isArray(chartData.dependencies) ? chartData.dependencies : []);
  const markersList = () => (Array.isArray(chartData.markers) ? chartData.markers : []);
  const holidaysListData = () => (Array.isArray(chartData.holidays) ? chartData.holidays : []);
  const notesList = () => (Array.isArray(chartData.notes) ? chartData.notes : []);
  const itemById = (id) => itemsList().find((it) => it && it.id === id) || null;
  const markerById = (id) => markersList().find((m) => m && m.id === id) || null;
  const noteById = (id) => notesList().find((n) => n && n.id === id) || null;
  const noteForTarget = (targetId) => notesList().find((n) => n && n.target === targetId) || null;
  const depKeyOf = (d) => `${d.from}|${d.to}|${d.type === 'ss' ? 'ss' : 'fs'}`;
  const currentZoom = () => (Object.prototype.hasOwnProperty.call(GANTT_ZOOMS, chartData.zoom) ? chartData.zoom : 'month');
  const isTyping = () => {
    const a = document.activeElement;
    return !!a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  };

  function htmlEl(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => el.setAttribute(k, String(attrs[k])));
    }
    return el;
  }

  function newId(prefix) {
    const used = new Set([
      ...itemsList().map((o) => o && o.id),
      ...markersList().map((o) => o && o.id),
      ...notesList().map((o) => o && o.id)
    ]);
    const base = `${prefix}_${Date.now()}`;
    let id = base;
    let k = 2;
    while (used.has(id)) id = `${base}_${k++}`;
    return id;
  }

  function cleanLabel(v, fallback) {
    const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
    return t || fallback;
  }

  // Client-side Today date: supports ?today=YYYY-MM-DD for deterministic screenshots & E2E tests.
  function getTodayStr() {
    const param = new URLSearchParams(window.location.search).get('today');
    if (param) {
      const parsed = ganttFormatDate(param);
      if (parsed) return parsed;
    }
    const now = new Date();
    const y = String(now.getFullYear()).padStart(4, '0');
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getTimeState(item, todayStr) {
    if (!item || !item._start || !item._end || !todayStr) return 'upcoming';
    if (item._end < todayStr) return 'past';
    if (item._start <= todayStr && todayStr <= item._end) return 'active';
    return 'upcoming';
  }

  function formatShortDate(iso) {
    const dt = ganttParseDate(iso);
    if (!dt) return iso || '';
    return `${MONTH_SHORT[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
  }

  function formatDateRange(startIso, endIso) {
    if (!startIso) return '';
    if (!endIso || startIso === endIso) return formatShortDate(startIso);
    return `${formatShortDate(startIso)} – ${formatShortDate(endIso)}`;
  }

  function formatBarTip(it) {
    if (!it || !it._start) return '';
    const endIso = it._end || it._start;
    const days = Math.max(1, ganttDiffDays(it._start, endIso) + 1);
    return `${formatDateRange(it._start, endIso)} · ${days}d`;
  }

  const showWeekendsPref = () => chartData.showWeekends !== false;
  const showWeekendsActive = (zoomKey) => {
    const z = zoomKey || currentZoom();
    return showWeekendsPref() && Boolean(GANTT_ZOOMS[z] && GANTT_ZOOMS[z].showWeekends);
  };

  function dateFromClientX(clientX) {
    const range = chartData._range;
    if (!range || !bodyEl) return getTodayStr();
    const rect = bodyEl.getBoundingClientRect();
    const x = clientX - rect.left;
    const snapDays = (GANTT_ZOOMS[currentZoom()] || GANTT_ZOOMS.month).snapDays;
    const rawDays = x / range.pxPerDay;
    const snapped = Math.round(rawDays / snapDays) * snapDays;
    return ganttAddDays(range.start, snapped);
  }

  function itemFromClientY(clientY) {
    if (!bodyEl) return null;
    const rect = bodyEl.getBoundingClientRect();
    const y = clientY - rect.top;
    if (y < 0) return null;
    const rowIdx = Math.floor(y / GANTT_METRICS.ROW_H);
    const vis = visibleItems();
    return (rowIdx >= 0 && rowIdx < vis.length) ? vis[rowIdx] : null;
  }

  function hideGhostBar() {
    if (ghostBarEl) {
      ghostBarEl.remove();
      ghostBarEl = null;
    }
    ghostRowId = null;
  }

  function showGhostBar(it, startDate, endDate, customLabel) {
    const range = chartData._range;
    if (!range || !barsEl || !it || typeof it._row !== 'number' || it._row < 0) return;
    const s = startDate <= endDate ? startDate : endDate;
    const e = startDate <= endDate ? endDate : startDate;
    const spanDays = Math.max(1, ganttDiffDays(s, e) + 1);
    const x = ganttDiffDays(range.start, s) * range.pxPerDay;
    const w = Math.max(range.pxPerDay, spanDays * range.pxPerDay);
    const h = GANTT_METRICS.BAR_H;
    const y = it._row * GANTT_METRICS.ROW_H + (GANTT_METRICS.ROW_H - h) / 2;
    if (!ghostBarEl) {
      ghostBarEl = htmlEl('div', 'gantt-ghost-bar');
      ghostBarEl.setAttribute('data-export-skip', '');
      barsEl.appendChild(ghostBarEl);
    }
    ghostRowId = it.id;
    ghostBarEl.style.left = `${x}px`;
    ghostBarEl.style.top = `${y}px`;
    ghostBarEl.style.width = `${w}px`;
    ghostBarEl.style.height = `${h}px`;
    ghostBarEl.textContent = customLabel || `${formatDateRange(s, e)} · ${spanDays}d`;
  }

  // ISO week number (UTC)
  function isoWeekNumber(dt) {
    const tmp = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
  }

  function visibleItems() {
    return itemsList()
      .filter((it) => it && !it._hidden && typeof it._row === 'number' && it._row >= 0)
      .sort((a, b) => a._row - b._row);
  }

  function getDescendants(parentId) {
    const out = [];
    const byParent = new Map();
    itemsList().forEach((it) => {
      if (!it || !it.parent) return;
      if (!byParent.has(it.parent)) byParent.set(it.parent, []);
      byParent.get(it.parent).push(it);
    });
    const seen = new Set([parentId]);
    const walk = (pid) => {
      (byParent.get(pid) || []).forEach((ch) => {
        if (seen.has(ch.id)) return;
        seen.add(ch.id);
        out.push(ch);
        walk(ch.id);
      });
    };
    walk(parentId);
    return out;
  }

  function isAncestor(ancestorId, nodeId) {
    if (!ancestorId || !nodeId) return false;
    if (ancestorId === nodeId) return true;
    const seen = new Set([nodeId]);
    let cur = itemById(nodeId);
    while (cur && cur.parent) {
      if (cur.parent === ancestorId) return true;
      if (seen.has(cur.parent)) break;
      seen.add(cur.parent);
      cur = itemById(cur.parent);
    }
    return false;
  }

  function wouldCreateDepCycle(fromId, toId, ignoreDep) {
    if (fromId === toId) return true;
    const adj = new Map();
    depsList().forEach((d) => {
      if (!d || d === ignoreDep || !d.from || !d.to) return;
      if (!adj.has(d.from)) adj.set(d.from, []);
      adj.get(d.from).push(d.to);
    });
    const stack = [toId];
    const visited = new Set([toId]);
    while (stack.length) {
      const cur = stack.pop();
      if (cur === fromId) return true;
      (adj.get(cur) || []).forEach((nxt) => {
        if (!visited.has(nxt)) {
          visited.add(nxt);
          stack.push(nxt);
        }
      });
    }
    return false;
  }

  function collectMovableLeaves(ids) {
    const leafMap = new Map();
    ids.forEach((id) => {
      const it = itemById(id);
      if (!it) return;
      if (it._hasChildren || it.kind === 'group') {
        getDescendants(it.id).forEach((ch) => {
          if (!ch._hasChildren && ch.kind !== 'group' && (ch.start || ch._start)) {
            leafMap.set(ch.id, ch);
          }
        });
      } else if (it.start || it._start) {
        leafMap.set(it.id, it);
      }
    });
    return [...leafMap.values()];
  }

  // --- LAYOUT & RENDERING ---
  function applyLayout() {
    layoutDiagram(chartData);
  }

  function applySidebarWidth(w) {
    sidebarWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(w)));
    if (sidebar) sidebar.style.width = `${sidebarWidth}px`;
    if (root) root.style.setProperty('--gantt-sidebar-w', `${sidebarWidth}px`);
  }

  function ensureDepsSvg() {
    if (!depsEl) return null;
    if (depsEl.tagName && depsEl.tagName.toLowerCase() === 'svg') {
      renderedDepsSvg = depsEl;
    } else {
      let s = depsEl.querySelector('svg');
      if (!s) {
        s = svgEl('svg', { class: 'gantt-deps-svg' });
        depsEl.appendChild(s);
      }
      renderedDepsSvg = s;
    }
    return renderedDepsSvg;
  }

  function renderHeader(range, zoomKey, fullW) {
    if (!headerTop || !headerBottom || !headerEl) return;
    headerTop.textContent = '';
    headerBottom.textContent = '';

    const pxPerDay = range.pxPerDay;
    const totalW = fullW || range.timelineWidth;
    headerEl.style.width = `${totalW}px`;
    headerTop.style.width = `${totalW}px`;
    headerBottom.style.width = `${totalW}px`;
    if (headerMarkers) headerMarkers.style.width = `${totalW}px`;

    const startDt = ganttParseDate(range.start);
    const endDt = ganttParseDate(range.end);
    if (!startDt || !endDt) return;

    const gridLines = [];

    function addTick(container, left, width, text, extraCls) {
      const cell = htmlEl('div', `gantt-tick${extraCls ? ' ' + extraCls : ''}`, text);
      cell.style.left = `${left}px`;
      cell.style.width = `${width}px`;
      container.appendChild(cell);
    }

    // Helper: iterate calendar months covering [startDt, endDt]
    function forEachMonth(cb) {
      let y = startDt.getUTCFullYear();
      let m = startDt.getUTCMonth();
      const endY = endDt.getUTCFullYear();
      const endM = endDt.getUTCMonth();
      while (y < endY || (y === endY && m <= endM)) {
        const mStart = new Date(Date.UTC(y, m, 1));
        const mEnd = new Date(Date.UTC(y, m + 1, 0));
        const cStart = mStart < startDt ? startDt : mStart;
        const cEnd = mEnd > endDt ? endDt : mEnd;
        const left = ganttDiffDays(range.start, ganttFormatDate(cStart)) * pxPerDay;
        const days = ganttDiffDays(ganttFormatDate(cStart), ganttFormatDate(cEnd)) + 1;
        cb({ y, m, left, width: days * pxPerDay });
        m++;
        if (m > 11) { m = 0; y++; }
      }
    }

    // Helper: iterate calendar years covering [startDt, endDt]
    function forEachYear(cb) {
      const startY = startDt.getUTCFullYear();
      const endY = endDt.getUTCFullYear();
      for (let y = startY; y <= endY; y++) {
        const yStart = new Date(Date.UTC(y, 0, 1));
        const yEnd = new Date(Date.UTC(y, 11, 31));
        const cStart = yStart < startDt ? startDt : yStart;
        const cEnd = yEnd > endDt ? endDt : yEnd;
        const left = ganttDiffDays(range.start, ganttFormatDate(cStart)) * pxPerDay;
        const days = ganttDiffDays(ganttFormatDate(cStart), ganttFormatDate(cEnd)) + 1;
        cb({ y, left, width: days * pxPerDay });
      }
    }

    if (zoomKey === 'day') {
      const showWknd = showWeekendsActive(zoomKey);
      forEachMonth(({ y, m, left, width }) => {
        addTick(headerTop, left, width, `${MONTH_LONG[m]} ${y}`, 'gantt-tick-top');
      });
      for (let i = 0; i < range.totalDays; i++) {
        const iso = ganttAddDays(range.start, i);
        const dt = ganttParseDate(iso);
        const dow = dt.getUTCDay();
        const isWknd = dow === 0 || dow === 6;
        const left = i * pxPerDay;
        const cell = htmlEl('div', `gantt-tick gantt-tick-bot is-day${isWknd && showWknd ? ' is-weekend' : ''}`);
        cell.style.left = `${left}px`;
        cell.style.width = `${pxPerDay}px`;
        cell.append(
          htmlEl('span', 'gantt-day-num', String(dt.getUTCDate())),
          htmlEl('span', 'gantt-day-dow', WEEKDAY_SHORT[dow])
        );
        headerBottom.appendChild(cell);
        gridLines.push({ x: left, major: dt.getUTCDate() === 1 });
      }
    } else if (zoomKey === 'week') {
      forEachMonth(({ y, m, left, width }) => {
        addTick(headerTop, left, width, `${MONTH_LONG[m]} ${y}`, 'gantt-tick-top');
      });
      // Align week ticks to Mondays
      let curIso = range.start;
      const startDow = startDt.getUTCDay();
      const backToMon = startDow === 0 ? 6 : startDow - 1;
      curIso = ganttAddDays(range.start, -backToMon);
      while (curIso <= range.end) {
        const wkEnd = ganttAddDays(curIso, 6);
        const cStart = curIso < range.start ? range.start : curIso;
        const cEnd = wkEnd > range.end ? range.end : wkEnd;
        const left = ganttDiffDays(range.start, cStart) * pxPerDay;
        const days = ganttDiffDays(cStart, cEnd) + 1;
        const dt = ganttParseDate(curIso);
        const wkNum = isoWeekNumber(dt);
        const lbl = `W${wkNum} · ${MONTH_SHORT[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
        addTick(headerBottom, left, days * pxPerDay, lbl, 'gantt-tick-bot');
        if (left > 0) gridLines.push({ x: left, major: dt.getUTCDate() <= 7 });
        curIso = ganttAddDays(curIso, 7);
      }
    } else if (zoomKey === 'month') {
      forEachYear(({ y, left, width }) => {
        addTick(headerTop, left, width, String(y), 'gantt-tick-top');
      });
      forEachMonth(({ m, left, width }) => {
        addTick(headerBottom, left, width, MONTH_SHORT[m], 'gantt-tick-bot');
        gridLines.push({ x: left, major: m === 0 });
      });
    } else if (zoomKey === 'quarter') {
      forEachYear(({ y, left, width }) => {
        addTick(headerTop, left, width, String(y), 'gantt-tick-top');
      });
      for (let y = startDt.getUTCFullYear(); y <= endDt.getUTCFullYear(); y++) {
        for (let q = 0; q < 4; q++) {
          const qStart = new Date(Date.UTC(y, q * 3, 1));
          const qEnd = new Date(Date.UTC(y, q * 3 + 3, 0));
          if (qEnd < startDt || qStart > endDt) continue;
          const cStart = qStart < startDt ? startDt : qStart;
          const cEnd = qEnd > endDt ? endDt : qEnd;
          const left = ganttDiffDays(range.start, ganttFormatDate(cStart)) * pxPerDay;
          const days = ganttDiffDays(ganttFormatDate(cStart), ganttFormatDate(cEnd)) + 1;
          addTick(headerBottom, left, days * pxPerDay, `Q${q + 1}`, 'gantt-tick-bot');
          gridLines.push({ x: left, major: q === 0 });
        }
      }
    } else {
      // year
      forEachYear(({ y, left, width }) => {
        addTick(headerTop, left, width, String(y), 'gantt-tick-top');
      });
      for (let y = startDt.getUTCFullYear(); y <= endDt.getUTCFullYear(); y++) {
        for (let h = 0; h < 2; h++) {
          const hStart = new Date(Date.UTC(y, h * 6, 1));
          const hEnd = new Date(Date.UTC(y, h * 6 + 6, 0));
          if (hEnd < startDt || hStart > endDt) continue;
          const cStart = hStart < startDt ? startDt : hStart;
          const cEnd = hEnd > endDt ? endDt : hEnd;
          const left = ganttDiffDays(range.start, ganttFormatDate(cStart)) * pxPerDay;
          const days = ganttDiffDays(ganttFormatDate(cStart), ganttFormatDate(cEnd)) + 1;
          addTick(headerBottom, left, days * pxPerDay, `H${h + 1}`, 'gantt-tick-bot');
          gridLines.push({ x: left, major: h === 0 });
        }
      }
    }

    return gridLines;
  }

  function renderGrid(range, zoomKey, visItems, gridLines, fullW) {
    if (!gridEl) return;
    gridEl.textContent = '';
    els.rowBgs.clear();
    if (headerMarkers) {
      headerMarkers.querySelectorAll('.gantt-holiday-flag').forEach((n) => n.remove());
    }
    const rowH = GANTT_METRICS.ROW_H;
    const totalH = Math.max(1, visItems.length) * rowH;
    const totalW = fullW || range.timelineWidth;
    gridEl.style.width = `${totalW}px`;
    gridEl.style.height = `${totalH}px`;

    // Horizontal row stripes
    const edit = !presenting();
    visItems.forEach((it, idx) => {
      const isUnscheduledLeaf = !it._bar && it.kind !== 'group' && !it._hasChildren;
      const rowBg = htmlEl('div', `gantt-row-bg${idx % 2 === 1 ? ' is-alt' : ''}${selItems.has(it.id) ? ' is-selected' : ''}${hoveredRowId === it.id ? ' is-hovered' : ''}${isUnscheduledLeaf ? ' is-unscheduled' : ''}`);
      rowBg.dataset.rowId = it.id;
      rowBg.style.top = `${idx * rowH}px`;
      rowBg.style.height = `${rowH}px`;
      rowBg.style.width = `${totalW}px`;
      rowBg.addEventListener('pointerenter', () => setHoveredRow(it.id));
      rowBg.addEventListener('pointerleave', () => {
        if (hoveredRowId === it.id) setHoveredRow(null);
        if (!activeDrag && ghostRowId === it.id) hideGhostBar();
      });
      if (edit && isUnscheduledLeaf) {
        rowBg.addEventListener('pointermove', (ev) => {
          if (activeDrag || connectState) return;
          const d = dateFromClientX(ev.clientX);
          const previewEnd = it.kind === 'milestone' ? d : ganttAddDays(d, 6);
          showGhostBar(it, d, previewEnd, `+ Schedule · ${formatShortDate(d)}`);
        });
        rowBg.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || e.shiftKey || activeDrag || connectState) return;
          e.stopPropagation();
          const anchorDate = dateFromClientX(e.clientX);
          const startX = e.clientX;
          let endDate = anchorDate;
          let dragged = false;
          activeDrag = { kind: 'schedule', item: it };
          removeActionBar();
          showGhostBar(it, anchorDate, it.kind === 'milestone' ? anchorDate : ganttAddDays(anchorDate, 6), `+ Schedule · ${formatShortDate(anchorDate)}`);

          const onMove = (ev) => {
            if (!dragged && Math.abs(ev.clientX - startX) > 4) dragged = true;
            if (!dragged) return;
            endDate = dateFromClientX(ev.clientX);
            const s = anchorDate <= endDate ? anchorDate : endDate;
            const en = it.kind === 'milestone' ? s : (anchorDate <= endDate ? endDate : anchorDate);
            showGhostBar(it, s, en);
            const days = Math.max(1, ganttDiffDays(s, en) + 1);
            showDragTip(ev.clientX, ev.clientY, `${formatDateRange(s, en)} · ${days}d`);
          };
          const onUp = (ev) => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            activeDrag = null;
            hideGhostBar();
            hideDragTip();
            if (ev.type === 'pointerup') {
              if (dragged) {
                const s = anchorDate <= endDate ? anchorDate : endDate;
                const en = anchorDate <= endDate ? endDate : anchorDate;
                it.start = s;
                it.end = it.kind === 'milestone' ? s : en;
              } else {
                it.start = anchorDate;
                it.end = it.kind === 'milestone' ? anchorDate : ganttAddDays(anchorDate, 6);
              }
              selectSingleItem(it.id);
              render();
              updateStatus(true);
            }
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
          window.addEventListener('pointercancel', onUp);
        });
      }
      gridEl.appendChild(rowBg);
      els.rowBgs.set(it.id, rowBg);
    });

    // Weekend bands (Day / Week only, when showWeekends is enabled)
    if (showWeekendsActive(zoomKey)) {
      const pxPerDay = range.pxPerDay;
      for (let i = 0; i < range.totalDays; i++) {
        const iso = ganttAddDays(range.start, i);
        const dt = ganttParseDate(iso);
        const dow = dt.getUTCDay();
        if (dow === 0 || dow === 6) {
          const band = htmlEl('div', 'gantt-weekend');
          band.style.left = `${i * pxPerDay}px`;
          band.style.width = `${pxPerDay}px`;
          band.style.height = `${totalH}px`;
          gridEl.appendChild(band);
        }
      }
    }

    // Holiday bands + header chips
    (chartData._holidays || []).forEach((h) => {
      const band = htmlEl('div', 'gantt-holiday');
      band.style.left = `${h.x}px`;
      band.style.width = `${Math.max(2, h.w)}px`;
      band.style.height = `${totalH}px`;
      const tip = h.country ? `${h.name || 'Holiday'} (${h.country}) · ${formatDateRange(h.start, h.end)}` : `${h.name || 'Holiday'} · ${formatDateRange(h.start, h.end)}`;
      band.dataset.tip = tip;
      band.title = tip;
      gridEl.appendChild(band);
    });

    // Vertical gridlines
    (gridLines || []).forEach((gl) => {
      const line = htmlEl('div', `gantt-gridline${gl.major ? ' is-major' : ''}`);
      line.style.left = `${gl.x}px`;
      line.style.height = `${totalH}px`;
      gridEl.appendChild(line);
    });
  }

  function renderSidebar(visItems) {
    if (!treeEl) return;
    treeEl.textContent = '';
    els.rows.clear();
    const rowH = GANTT_METRICS.ROW_H;
    const edit = !presenting();

    visItems.forEach((it, idx) => {
      const row = htmlEl('div', `gantt-tree-row${idx % 2 === 1 ? ' is-alt' : ''}`);
      row.dataset.itemId = it.id;
      row.dataset.kind = it.kind || 'task';
      row.style.height = `${rowH}px`;
      row.style.paddingLeft = `${8 + (it._depth || 0) * 18}px`;
      if (it._hasChildren || it.kind === 'group') row.classList.add('is-parent');
      if (selItems.has(it.id)) row.classList.add('selected');
      if (hoveredRowId === it.id) row.classList.add('is-hovered');
      if (edit) {
        row.draggable = false; // pointer-based row drag
        const grip = htmlEl('span', 'gantt-row-grip', '⋮');
        grip.setAttribute('aria-hidden', 'true');
        grip.setAttribute('data-export-skip', '');
        row.appendChild(grip);
      }

      // Collapse/expand chevron
      if (it._hasChildren || it.kind === 'group') {
        const chev = htmlEl('button', 'gantt-chevron');
        chev.type = 'button';
        chev.setAttribute('aria-expanded', String(!it.collapsed));
        chev.setAttribute('aria-label', it.collapsed ? `Expand ${it.label || it.id}` : `Collapse ${it.label || it.id}`);
        chev.innerHTML = ui.icon('chevron-down', { size: 'xs', bold: true });
        if (it.collapsed) chev.classList.add('is-collapsed');
        chev.addEventListener('pointerdown', (e) => e.stopPropagation());
        chev.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleCollapse(it.id);
        });
        row.appendChild(chev);
      } else {
        row.appendChild(htmlEl('span', 'gantt-chevron-spacer'));
      }

      // Kind indicator dot / diamond
      const dot = htmlEl('span', `gantt-tree-dot is-${it.kind || 'task'}`);
      setSwatch(dot, it.color || (it.kind === 'milestone' ? '4' : '1'));
      row.appendChild(dot);

      // Label
      const lbl = htmlEl('span', 'gantt-tree-label', it.label || it.id);
      lbl.title = it.label || it.id;
      lbl.dataset.tip = it.label || it.id;
      row.appendChild(lbl);

      // Quick + subtask button on hover
      if (edit && it.kind !== 'milestone') {
        const addBtn = htmlEl('button', 'gantt-row-add');
        addBtn.type = 'button';
        addBtn.title = `Add subtask under ${it.label || it.id}`;
        addBtn.setAttribute('aria-label', addBtn.title);
        addBtn.setAttribute('data-export-skip', '');
        addBtn.innerHTML = ui.icon('plus', { size: 'xs', bold: true });
        addBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          addSubtask(it.id);
        });
        row.appendChild(addBtn);
      }

      row.addEventListener('pointerdown', (e) => onSidebarRowPointerDown(e, it));
      row.addEventListener('pointerenter', () => onItemHover(it.id, true));
      row.addEventListener('pointerleave', () => onItemHover(it.id, false));
      row.addEventListener('dblclick', (e) => {
        if (!edit) return;
        e.stopPropagation();
        startInlineRename(it.id, lbl);
      });

      treeEl.appendChild(row);
      els.rows.set(it.id, row);
    });
  }

  function renderBars(visItems, todayStr) {
    if (!barsEl) return;
    hideGhostBar();
    barsEl.textContent = '';
    els.bars.clear();
    const edit = !presenting();
    const hasOutFs = new Set();
    (chartData._deps || []).forEach((d) => {
      if (d && d.from && d.type !== 'ss') hasOutFs.add(d.from);
    });

    visItems.forEach((it) => {
      if (!it._bar) return;
      const b = it._bar;
      const isParent = Boolean(it._hasChildren || it.kind === 'group');
      const isMilestone = it.kind === 'milestone' && !it._hasChildren;
      const note = noteForTarget(it.id);
      const timeState = getTimeState(it, todayStr);

      if (isMilestone) {
        const ms = htmlEl('div', 'gantt-milestone');
        ms.dataset.itemId = it.id;
        ms.dataset.nodeId = it.id;
        ms.dataset.kind = 'milestone';
        ms.dataset.timeState = timeState;
        ms.style.left = `${b.x}px`;
        ms.style.top = `${b.y}px`;
        ms.style.width = `${b.w}px`;
        ms.style.height = `${b.h}px`;
        setSwatch(ms, it.color || '4');
        if (selItems.has(it.id)) ms.classList.add('selected');
        if (note) ms.classList.add('has-note');
        ms.dataset.tip = `${it.label || it.id} · ${formatShortDate(it._start)}`;
        ms.title = ms.dataset.tip;

        const diamond = htmlEl('div', 'gantt-ms-diamond');
        ms.appendChild(diamond);

        const lbl = htmlEl('span', 'gantt-ms-label', it.label || it.id);
        ms.appendChild(lbl);

        if (note) {
          const badge = htmlEl('button', 'note-badge');
          badge.type = 'button';
          badge.setAttribute('data-export-skip', '');
          badge.setAttribute('aria-label', `Note: ${note.text || ''}`);
          badge.title = note.text || 'Note';
          badge.innerHTML = ui.icon('note-lines', { size: 'xs', bold: true });
          badge.addEventListener('pointerdown', (e) => e.stopPropagation());
          badge.addEventListener('click', (e) => {
            e.stopPropagation();
            peekOrEditNote(it.id);
          });
          ms.appendChild(badge);
        }

        if (edit) {
          ms.setAttribute('data-touch-drag', '1');
          const portL = htmlEl('span', 'gantt-port gantt-port-l');
          portL.dataset.port = 'ss';
          portL.title = 'Drag to connect (Start-to-Start)';
          portL.setAttribute('data-export-skip', '');
          portL.addEventListener('pointerdown', (e) => onPortPointerDown(e, it.id, 'ss'));

          const portR = htmlEl('span', 'gantt-port gantt-port-r');
          portR.dataset.port = 'fs';
          portR.title = 'Drag to connect (Finish-to-Start)';
          portR.setAttribute('data-export-skip', '');
          portR.addEventListener('pointerdown', (e) => onPortPointerDown(e, it.id, 'fs'));

          ms.append(portL, portR);
        }

        ms.addEventListener('pointerdown', (e) => onBarPointerDown(e, it));
        ms.addEventListener('pointerenter', () => onItemHover(it.id, true));
        ms.addEventListener('pointerleave', () => onItemHover(it.id, false));
        ms.addEventListener('dblclick', (e) => {
          if (!edit) return;
          e.stopPropagation();
          const row = els.rows.get(it.id);
          startInlineRename(it.id, row ? row.querySelector('.gantt-tree-label') : lbl);
        });

        barsEl.appendChild(ms);
        els.bars.set(it.id, ms);
        return;
      }

      // Task bar or Parent summary bar (never render task text inside bars; sidebar is frozen)
      const bar = htmlEl('div', isParent ? 'gantt-bar gantt-summary' : 'gantt-bar');
      bar.dataset.itemId = it.id;
      bar.dataset.nodeId = it.id;
      bar.dataset.kind = isParent ? 'group' : 'task';
      bar.dataset.timeState = timeState;
      const barW = Math.max(4, b.w);
      bar.style.left = `${b.x}px`;
      bar.style.top = `${b.y}px`;
      bar.style.width = `${barW}px`;
      bar.style.height = `${b.h}px`;
      setSwatch(bar, it.color || '1');
      if (selItems.has(it.id)) bar.classList.add('selected');
      if (note) bar.classList.add('has-note');
      if (hasOutFs.has(it.id)) bar.classList.add('has-out-dep');

      const tipText = formatBarTip(it);
      bar.dataset.tip = tipText;
      bar.title = tipText;

      if (note) {
        const badge = htmlEl('button', 'note-badge');
        badge.type = 'button';
        badge.setAttribute('data-export-skip', '');
        badge.setAttribute('aria-label', `Note: ${note.text || ''}`);
        badge.title = note.text || 'Note';
        badge.innerHTML = ui.icon('note-lines', { size: 'xs', bold: true });
        badge.addEventListener('pointerdown', (e) => e.stopPropagation());
        badge.addEventListener('click', (e) => {
          e.stopPropagation();
          peekOrEditNote(it.id);
        });
        bar.appendChild(badge);
      }

      if (edit && !isParent) {
        bar.setAttribute('data-touch-drag', '1');
        const resL = htmlEl('span', 'gantt-resize gantt-resize-l');
        resL.title = 'Resize start date';
        resL.setAttribute('data-export-skip', '');
        resL.addEventListener('pointerdown', (e) => onResizePointerDown(e, it, 'start'));

        const resR = htmlEl('span', 'gantt-resize gantt-resize-r');
        resR.title = 'Resize end date';
        resR.setAttribute('data-export-skip', '');
        resR.addEventListener('pointerdown', (e) => onResizePointerDown(e, it, 'end'));

        bar.append(resL, resR);
      }

      if (edit) {
        const portL = htmlEl('span', 'gantt-port gantt-port-l');
        portL.dataset.port = 'ss';
        portL.title = 'Drag to connect (Start-to-Start)';
        portL.setAttribute('data-export-skip', '');
        portL.addEventListener('pointerdown', (e) => onPortPointerDown(e, it.id, 'ss'));

        const portR = htmlEl('span', 'gantt-port gantt-port-r');
        portR.dataset.port = 'fs';
        portR.title = 'Drag to connect (Finish-to-Start)';
        portR.setAttribute('data-export-skip', '');
        portR.addEventListener('pointerdown', (e) => onPortPointerDown(e, it.id, 'fs'));

        bar.append(portL, portR);
      }

      bar.addEventListener('pointerdown', (e) => onBarPointerDown(e, it));
      bar.addEventListener('pointerenter', () => onItemHover(it.id, true));
      bar.addEventListener('pointerleave', () => onItemHover(it.id, false));
      bar.addEventListener('dblclick', (e) => {
        if (!edit) return;
        e.stopPropagation();
        const row = els.rows.get(it.id);
        startInlineRename(it.id, row ? row.querySelector('.gantt-tree-label') : null);
      });

      barsEl.appendChild(bar);
      els.bars.set(it.id, bar);
    });
  }

  function renderMarkers(visItems) {
    if (markersEl) markersEl.textContent = '';
    if (headerMarkers) {
      headerMarkers.querySelectorAll('.gantt-marker-flag').forEach((n) => n.remove());
    }
    els.markers.clear();

    const totalH = Math.max(1, visItems.length) * GANTT_METRICS.ROW_H;
    const edit = !presenting();

    (chartData._markers || []).forEach((m) => {
      const line = htmlEl('div', 'gantt-marker-line');
      line.dataset.markerId = m.id;
      line.style.left = `${m.x}px`;
      line.style.height = `${totalH}px`;
      setSwatch(line, m.color || '4');
      if (selMarkerId === m.id) line.classList.add('selected');

      const flagText = m.date ? `${m.label || 'Milestone'} · ${formatShortDate(m.date)}` : (m.label || 'Milestone');
      const flag = htmlEl('div', 'gantt-marker-flag', flagText);
      flag.dataset.markerId = m.id;
      flag.style.left = `${m.x}px`;
      setSwatch(flag, m.color || '4');
      flag.dataset.tip = `${m.label || 'Milestone'} · ${formatShortDate(m.date)}`;
      if (selMarkerId === m.id) flag.classList.add('selected');

      if (edit) {
        line.addEventListener('pointerdown', (e) => onMarkerPointerDown(e, m.id));
        flag.addEventListener('pointerdown', (e) => onMarkerPointerDown(e, m.id));
        flag.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const raw = markerById(m.id);
          if (raw) openMarkerRenamePop(flag, raw);
        });
      }

      if (markersEl) markersEl.appendChild(line);
      if (headerMarkers) headerMarkers.appendChild(flag);
      els.markers.set(m.id, { line, flag });
    });
  }

  function renderToday(range, visItems, todayStr) {
    if (todayEl) todayEl.textContent = '';
    if (headerMarkers) {
      headerMarkers.querySelectorAll('.gantt-today-pill').forEach((n) => n.remove());
    }
    if (chartData.showToday === false || !todayStr || !range) return;
    if (todayStr < range.start || todayStr > range.end) return;

    const x = Math.round((ganttDiffDays(range.start, todayStr) + 0.5) * range.pxPerDay * 10) / 10;
    const totalH = Math.max(1, visItems.length) * GANTT_METRICS.ROW_H;

    if (todayEl) {
      const line = htmlEl('div', 'gantt-today-line');
      line.style.left = `${x}px`;
      line.style.height = `${totalH}px`;
      line.dataset.today = todayStr;
      todayEl.appendChild(line);
    }
    if (headerMarkers) {
      const pill = htmlEl('div', 'gantt-today-pill', `Today · ${formatShortDate(todayStr)}`);
      pill.style.left = `${x}px`;
      pill.title = `Today · ${todayStr}`;
      headerMarkers.appendChild(pill);
    }
  }

  function renderDependencies(range, visItems) {
    const svg = ensureDepsSvg();
    if (!svg) return;
    svg.textContent = '';
    els.deps.clear();

    const totalW = range.timelineWidth;
    const totalH = Math.max(1, visItems.length) * GANTT_METRICS.ROW_H;
    svg.setAttribute('width', String(totalW));
    svg.setAttribute('height', String(totalH));
    svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
    svg.style.width = `${totalW}px`;
    svg.style.height = `${totalH}px`;

    // Arrowhead defs
    const defs = svgEl('defs');
    [
      ['gantt-arr', 'gantt-arr-fill'],
      ['gantt-arr-warn', 'gantt-arr-warn-fill'],
      ['gantt-arr-sel', 'gantt-arr-sel-fill']
    ].forEach(([id, cls]) => {
      const mk = svgEl('marker', {
        id,
        viewBox: '0 0 10 10',
        refX: '8.5',
        refY: '5',
        markerWidth: '7',
        markerHeight: '7',
        orient: 'auto-start-reverse'
      });
      mk.appendChild(svgEl('path', { d: 'M 1 1.5 L 9 5 L 1 8.5 z', class: cls }));
      defs.appendChild(mk);
    });
    svg.appendChild(defs);

    (chartData._deps || []).forEach((dep) => {
      const key = depKeyOf(dep);
      const isSel = selDepKey === key;
      const g = svgEl('g', {
        class: `gantt-dep-group${dep.violated ? ' violated' : ''}${isSel ? ' selected' : ''}`,
        'data-from': dep.from,
        'data-to': dep.to,
        'data-dep-type': dep.type
      });

      const tipText = dep.violated
        ? (dep.type === 'ss' ? 'Starts before prerequisite starts' : 'Starts before prerequisite ends')
        : `${dep.type.toUpperCase()} dependency`;
      const titleEl = svgEl('title');
      titleEl.textContent = tipText;
      g.appendChild(titleEl);

      const hit = svgEl('path', {
        d: dep.path,
        class: 'gantt-dep-hit',
        fill: 'none',
        stroke: 'transparent',
        'stroke-width': '12'
      });
      const markerUrl = isSel ? 'url(#gantt-arr-sel)' : dep.violated ? 'url(#gantt-arr-warn)' : 'url(#gantt-arr)';
      const path = svgEl('path', {
        d: dep.path,
        class: `gantt-dep-path${dep.violated ? ' violated' : ''}${isSel ? ' selected' : ''}`,
        fill: 'none',
        'marker-end': markerUrl
      });

      g.append(hit, path);
      g.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || presenting()) return;
        e.stopPropagation();
        selectDependency(key);
      });

      svg.appendChild(g);
      els.deps.set(key, { g, path, hit });
    });

    syncDepsVisibility();
    syncDepSpotlight();
  }

  function syncDepsVisibility() {
    if (depsEl) depsEl.classList.toggle('is-hidden', !showDeps);
    if (btnDeps) {
      btnDeps.setAttribute('aria-checked', String(showDeps));
      btnDeps.title = showDeps ? 'Hide dependency arrows' : 'Show dependency arrows';
    }
  }

  function computeConnectedDepKeys(seedIds) {
    const chain = new Set();
    if (!seedIds || !seedIds.length) return chain;
    const deps = chartData._deps || [];
    if (!deps.length) return chain;
    const outMap = new Map();
    const inMap = new Map();
    deps.forEach((d) => {
      if (!d || !d.from || !d.to) return;
      if (!outMap.has(d.from)) outMap.set(d.from, []);
      outMap.get(d.from).push(d);
      if (!inMap.has(d.to)) inMap.set(d.to, []);
      inMap.get(d.to).push(d);
    });

    const visitedUp = new Set(seedIds);
    const upQueue = [...seedIds];
    while (upQueue.length) {
      const cur = upQueue.pop();
      (inMap.get(cur) || []).forEach((d) => {
        chain.add(depKeyOf(d));
        if (!visitedUp.has(d.from)) {
          visitedUp.add(d.from);
          upQueue.push(d.from);
        }
      });
    }

    const visitedDown = new Set(seedIds);
    const downQueue = [...seedIds];
    while (downQueue.length) {
      const cur = downQueue.pop();
      (outMap.get(cur) || []).forEach((d) => {
        chain.add(depKeyOf(d));
        if (!visitedDown.has(d.to)) {
          visitedDown.add(d.to);
          downQueue.push(d.to);
        }
      });
    }
    return chain;
  }

  function syncDepSpotlight() {
    if (!depsEl) return;
    const seeds = hoveredItemId ? [hoveredItemId] : [...selItems];
    const hasFocus = seeds.length > 0;
    const chainKeys = hasFocus ? computeConnectedDepKeys(seeds) : new Set();
    depsEl.classList.toggle('has-focus', hasFocus);

    const depByKey = new Map();
    (chartData._deps || []).forEach((d) => {
      if (d) depByKey.set(depKeyOf(d), d);
    });

    els.deps.forEach((rec, key) => {
      const isChain = hasFocus && chainKeys.has(key);
      const isSel = selDepKey === key;
      rec.path.classList.toggle('is-chain', isChain);
      const dep = depByKey.get(key);
      const url = (dep && dep.violated)
        ? 'url(#gantt-arr-warn)'
        : (isSel || isChain) ? 'url(#gantt-arr-sel)' : 'url(#gantt-arr)';
      rec.path.setAttribute('marker-end', url);
    });
  }

  function toggleLegendPop(force, pin) {
    if (!colorKeyHost) return;
    const show = typeof force === 'boolean' ? force : !legendOpen;
    legendOpen = show;
    if (!show) legendPinned = false;
    else if (typeof pin === 'boolean') legendPinned = pin;
    colorKeyHost.hidden = !show;
    if (btnLegend) btnLegend.setAttribute('aria-expanded', String(show));
  }

  function renderColorKey() {
    if (!colorKeyHost) return;
    colorKeyHost.textContent = '';
    const usedSet = new Set();
    itemsList().forEach((it) => { if (it && it.color) usedSet.add(colorSlot(it.color)); });
    markersList().forEach((m) => { if (m && m.color) usedSet.add(colorSlot(m.color)); });
    if (chartData.colorKey) {
      Object.keys(chartData.colorKey).forEach((k) => { if (chartData.colorKey[k]) usedSet.add(colorSlot(k)); });
    }
    const used = [...usedSet].sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b)));
    const hasOverlap = (chartData._deps || []).some((d) => d && d.violated);
    if (!used.length && !hasOverlap) {
      legendOpen = false;
      legendPinned = false;
      colorKeyHost.hidden = true;
      if (btnLegend) {
        btnLegend.hidden = true;
        btnLegend.setAttribute('aria-expanded', 'false');
      }
      return;
    }
    let box = used.length ? ui.colorKey(used, chartData.colorKey || {}, { prompts: !presenting() }) : null;
    if (!box && !hasOverlap) {
      legendOpen = false;
      legendPinned = false;
      colorKeyHost.hidden = true;
      if (btnLegend) {
        btnLegend.hidden = true;
        btnLegend.setAttribute('aria-expanded', 'false');
      }
      return;
    }
    if (!box) {
      box = htmlEl('div', 'color-key');
    }
    if (hasOverlap) {
      const ov = htmlEl('span', 'gantt-key-overlap');
      ov.title = 'A dependent task starts before its prerequisite finishes';
      const dash = htmlEl('span', 'gantt-key-overlap-line');
      dash.setAttribute('aria-hidden', 'true');
      ov.append(dash, htmlEl('span', 'gantt-key-overlap-text', 'Schedule overlap'));
      box.appendChild(ov);
    }
    if (btnLegend) {
      btnLegend.hidden = false;
      btnLegend.setAttribute('aria-expanded', String(legendOpen));
    }
    colorKeyHost.hidden = !legendOpen;
    colorKeyHost.appendChild(box);
    if (!presenting()) {
      box.querySelectorAll('.color-key-label').forEach((lbl) => {
        lbl.addEventListener('click', (e) => {
          e.stopPropagation();
          editColorKeySlot(lbl.dataset.color, lbl);
        });
      });
    }
  }

  function editColorKeySlot(slot, lbl) {
    if (presenting() || !slot || !lbl) return;
    legendPinned = true;
    lbl.contentEditable = 'true';
    lbl.focus();
    const finish = () => {
      lbl.contentEditable = 'false';
      const val = lbl.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!chartData.colorKey) chartData.colorKey = {};
      const prev = chartData.colorKey[slot] || '';
      if (val === prev) { renderColorKey(); return; }
      if (val) chartData.colorKey[slot] = val;
      else delete chartData.colorKey[slot];
      if (!Object.keys(chartData.colorKey).length) delete chartData.colorKey;
      renderColorKey();
      updateStatus(true);
    };
    lbl.addEventListener('blur', finish, { once: true });
    lbl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') lbl.textContent = (chartData.colorKey && chartData.colorKey[slot]) || '';
        lbl.blur();
      }
    });
  }

  // --- NOTES ---
  function isNoteVisible(n) {
    if (!n || !n.target) return false;
    const it = itemById(n.target);
    if (!it || it._hidden || !it._bar) return false;
    if (n.id === editingNoteId) return true;
    if (chartData.showNotes === true && n.text && n.text.trim()) return true;
    if (peekNoteItemId === n.target && n.text && n.text.trim()) return true;
    return false;
  }

  function renderNotes() {
    if (!notesEl) return;
    notesEl.textContent = '';
    els.notes.clear();
    const edit = !presenting();
    const live = notesList().filter(isNoteVisible);
    if (selNoteId && !live.some((n) => n.id === selNoteId)) selNoteId = null;

    live.forEach((n) => {
      const it = itemById(n.target);
      if (!it || !it._bar) return;
      const { card, text } = ui.noteCard(n, edit ? {
        onDelete: () => removeNote(n.id),
        onCommit: (el) => commitNote(n, el)
      } : {});
      card.classList.add('show');
      if (selNoteId === n.id) card.classList.add('selected');
      card.setAttribute('role', 'note');
      card.setAttribute('aria-label', `Note on ${it.label || it.id}: ${n.text || 'empty'}`);

      // Position beside/below bar in #gantt-body coordinates
      const b = it._bar;
      const x = Math.max(8, Math.min((chartData._range ? chartData._range.timelineWidth : 600) - 220, b.x + b.w + 12));
      const y = Math.max(4, b.y + b.h + 4);
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;

      if (edit) {
        text.addEventListener('blur', () => commitNote(n, text));
        card.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || e.target.isContentEditable) return;
          e.stopPropagation();
          selectNote(n.id);
        });
        card.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          editNote(n.id);
        });
      }

      notesEl.appendChild(card);
      els.notes.set(n.id, card);
    });
  }

  function updateNotesButton() {
    if (!btnNotes) return;
    const count = notesList().filter((n) => n && n.text && n.text.trim()).length;
    const on = chartData.showNotes === true;
    btnNotes.setAttribute('aria-checked', String(on));
    btnNotes.disabled = !count && !on;
    const c = btnNotes.querySelector('.btn-count');
    if (c) {
      c.textContent = count ? String(count) : '';
      c.hidden = !count;
    }
    btnNotes.title = !count ? 'No notes yet' : on ? 'Hide all notes' : 'Show all notes';
  }

  function toggleShowNotes() {
    chartData.showNotes = chartData.showNotes !== true;
    if (!chartData.showNotes) peekNoteItemId = null;
    renderNotes();
    updateNotesButton();
    if (!presenting()) updateStatus(true);
  }

  function selectNote(id) {
    selItems.clear();
    selMarkerId = null;
    selDepKey = null;
    selNoteId = id;
    syncSelectionUi();
  }

  function peekOrEditNote(itemId) {
    const n = noteForTarget(itemId);
    if (!n) return;
    if (presenting()) {
      peekNoteItemId = peekNoteItemId === itemId ? null : itemId;
      renderNotes();
      return;
    }
    peekNoteItemId = itemId;
    renderNotes();
    editNote(n.id);
  }

  function addOrEditNoteForTarget(itemId) {
    if (presenting()) return;
    const it = itemById(itemId);
    if (!it) {
      ui.toast('Select a task or milestone first to add a note');
      return;
    }
    const existing = noteForTarget(it.id);
    if (existing) {
      peekNoteItemId = it.id;
      renderNotes();
      editNote(existing.id);
      return;
    }
    if (!Array.isArray(chartData.notes)) chartData.notes = [];
    const note = { id: newId('n'), text: '', target: it.id };
    chartData.notes.push(note);
    noteDraft = { id: note.id, isNew: true, wasOn: chartData.showNotes === true, before: '' };
    editingNoteId = note.id;
    peekNoteItemId = it.id;
    render();
    editNote(note.id);
  }

  function editNote(id) {
    const n = noteById(id);
    const card = els.notes.get(id);
    if (!n || !card || presenting()) return;
    if (editingNoteId !== id || !noteDraft) {
      noteDraft = { id, isNew: false, wasOn: chartData.showNotes === true, before: (n.text || '').trim() };
    }
    editingNoteId = id;
    const text = card.querySelector('.note-text');
    if (!text) return;
    text.contentEditable = 'true';
    text.focus();
    const range = document.createRange();
    range.selectNodeContents(text);
    range.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }

  function commitNote(n, textEl) {
    textEl.contentEditable = 'false';
    if (editingNoteId !== n.id) return;
    const draft = noteDraft;
    editingNoteId = null;
    noteDraft = null;
    const val = textEl.innerText.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!val) {
      removeNote(n.id, !(draft && draft.isNew));
      return;
    }
    if (val === (draft ? draft.before : (n.text || '').trim())) {
      textEl.textContent = n.text;
      return;
    }
    n.text = val;
    textEl.textContent = val;
    render();
    updateStatus(true);
  }

  function removeNote(id, pushUndo = true) {
    chartData.notes = notesList().filter((n) => n && n.id !== id);
    if (!chartData.notes.length) delete chartData.notes;
    if (editingNoteId === id) { editingNoteId = null; noteDraft = null; }
    if (selNoteId === id) selNoteId = null;
    render();
    if (pushUndo) updateStatus(true);
  }

  function setHoveredRow(id) {
    const next = id || null;
    if (hoveredRowId === next) return;
    if (hoveredRowId) {
      const prevRow = els.rows.get(hoveredRowId);
      const prevBg = els.rowBgs.get(hoveredRowId);
      if (prevRow) prevRow.classList.remove('is-hovered');
      if (prevBg) prevBg.classList.remove('is-hovered');
    }
    hoveredRowId = next;
    if (hoveredRowId) {
      const nextRow = els.rows.get(hoveredRowId);
      const nextBg = els.rowBgs.get(hoveredRowId);
      if (nextRow) nextRow.classList.add('is-hovered');
      if (nextBg) nextBg.classList.add('is-hovered');
    }
  }

  function onItemHover(itemId, entering) {
    if (entering) {
      hoveredItemId = itemId;
      setHoveredRow(itemId);
    } else {
      if (hoveredItemId === itemId) hoveredItemId = null;
      if (hoveredRowId === itemId) setHoveredRow(null);
    }
    syncDepSpotlight();

    if (chartData.showNotes === true || editingNoteId) return;
    if (entering && noteForTarget(itemId)) {
      if (peekNoteItemId !== itemId) {
        peekNoteItemId = itemId;
        renderNotes();
      }
    } else if (!entering && peekNoteItemId === itemId && !selItems.has(itemId)) {
      peekNoteItemId = null;
      renderNotes();
    }
  }

  function syncZoomPills(zoomKey) {
    const host = zoomPills || document.getElementById('gantt-zoom-pills');
    if (!host) return;
    host.querySelectorAll('[data-zoom-set]').forEach((btn) => {
      const active = btn.dataset.zoomSet === zoomKey;
      btn.setAttribute('aria-pressed', String(active));
      btn.classList.toggle('is-active', active);
    });
  }

  function syncWeekendsButton() {
    const btn = btnWeekends || document.getElementById('btn-weekends');
    if (!btn) return;
    const pref = showWeekendsPref();
    const supported = Boolean(GANTT_ZOOMS[currentZoom()] && GANTT_ZOOMS[currentZoom()].showWeekends);
    btn.setAttribute('aria-checked', String(pref));
    btn.classList.toggle('is-dimmed', !supported);
    btn.title = supported
      ? (pref ? 'Hide weekend shading' : 'Show weekend shading')
      : 'Weekends show in Day and Week views';
  }

  function parentItems() {
    return itemsList().filter((it) => it && (it._hasChildren || it.kind === 'group'));
  }

  function syncToggleAllButton() {
    const btn = btnToggleAll || document.getElementById('btn-toggle-all');
    if (!btn) return;
    const parents = parentItems();
    btn.disabled = parents.length === 0;
    const anyExpanded = parents.some((it) => !it.collapsed);
    const label = anyExpanded ? 'Collapse all' : 'Expand all';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-expanded', String(anyExpanded));
    btn.innerHTML = ui.icon(anyExpanded ? 'chevron-up' : 'chevron-down', { size: 'xs', bold: true });
  }

  // --- MAIN RENDER ---
  function render() {
    applyLayout();
    const range = chartData._range;
    const zoomKey = currentZoom();
    if (root) root.dataset.zoom = zoomKey;
    const visItems = visibleItems();
    const todayStr = getTodayStr();
    const totalH = Math.max(1, visItems.length) * GANTT_METRICS.ROW_H;
    const fullW = Math.max(range.timelineWidth, (timeline && timeline.clientWidth) || 0);

    applySidebarWidth(sidebarWidth);

    if (bodyEl) {
      bodyEl.style.width = `${fullW}px`;
      bodyEl.style.height = `${totalH}px`;
    }
    if (barsEl) {
      barsEl.style.width = `${fullW}px`;
      barsEl.style.height = `${totalH}px`;
    }
    if (markersEl) {
      markersEl.style.width = `${fullW}px`;
      markersEl.style.height = `${totalH}px`;
    }
    if (todayEl) {
      todayEl.style.width = `${fullW}px`;
      todayEl.style.height = `${totalH}px`;
    }
    if (notesEl) {
      notesEl.style.width = `${fullW}px`;
      notesEl.style.height = `${totalH}px`;
    }

    const gridLines = renderHeader(range, zoomKey, fullW);
    renderGrid(range, zoomKey, visItems, gridLines, fullW);
    renderSidebar(visItems);
    renderBars(visItems, todayStr);
    renderMarkers(visItems);
    renderToday(range, visItems, todayStr);
    renderDependencies(range, visItems);
    renderNotes();
    renderColorKey();
    updateNotesButton();
    syncWeekendsButton();
    syncToggleAllButton();
    renderHolidaysList();
    syncSelectionUi();
    syncZoomPills(zoomKey);
    if (typeof showZoom === 'function') showZoom();

    if (!didInitialScroll && timeline && range) {
      didInitialScroll = true;
      const anchorDate = range.contentStart || range.start;
      const anchorX = ganttDiffDays(range.start, anchorDate) * range.pxPerDay;
      const targetLeft = Math.max(0, Math.round(anchorX - 48));
      isExtendingTimeline = true;
      timeline.scrollLeft = targetLeft;
      requestAnimationFrame(() => { isExtendingTimeline = false; });
    }
  }

  // Fast live geometry refresh during drag/resize without rebuilding the entire DOM
  function updateLiveGeometry() {
    applyLayout();
    const range = chartData._range;
    const visItems = visibleItems();
    const todayStr = getTodayStr();

    visItems.forEach((it) => {
      const el = els.bars.get(it.id);
      if (!el || !it._bar) return;
      const b = it._bar;
      el.style.left = `${b.x}px`;
      el.style.top = `${b.y}px`;
      el.style.width = `${Math.max(4, b.w)}px`;
      el.style.height = `${b.h}px`;
      el.dataset.timeState = getTimeState(it, todayStr);
      if (el.classList.contains('gantt-milestone')) {
        const tip = `${it.label || it.id} · ${formatShortDate(it._start)}`;
        el.dataset.tip = tip;
        el.title = tip;
      } else {
        const tip = formatBarTip(it);
        el.dataset.tip = tip;
        el.title = tip;
      }
    });

    (chartData._markers || []).forEach((m) => {
      const rec = els.markers.get(m.id);
      if (!rec) return;
      rec.line.style.left = `${m.x}px`;
      rec.flag.style.left = `${m.x}px`;
      rec.flag.textContent = m.date ? `${m.label || 'Milestone'} · ${formatShortDate(m.date)}` : (m.label || 'Milestone');
    });

    renderDependencies(range, visItems);
  }

  // --- DRAG TOOLTIP ---
  function showDragTip(clientX, clientY, text) {
    if (!dragTipEl) return;
    dragTipEl.textContent = text;
    dragTipEl.hidden = false;
    dragTipEl.style.left = `${clientX + 14}px`;
    dragTipEl.style.top = `${clientY - 28}px`;
  }

  function hideDragTip() {
    if (!dragTipEl) return;
    dragTipEl.hidden = true;
  }

  // --- SELECTION & ACTION BAR ---
  function clearSelection() {
    selItems.clear();
    lastSelItemId = null;
    selMarkerId = null;
    selDepKey = null;
    selNoteId = null;
    if (chartData.showNotes !== true) peekNoteItemId = null;
    closeFloatingPop();
    syncSelectionUi();
    renderNotes();
  }

  function hasSelection() {
    return !presenting() && (selItems.size > 0 || !!selMarkerId || !!selDepKey || !!selNoteId);
  }

  function selectSingleItem(id) {
    selItems.clear();
    selItems.add(id);
    lastSelItemId = id;
    selMarkerId = null;
    selDepKey = null;
    selNoteId = null;
    if (chartData.showNotes !== true && noteForTarget(id)) peekNoteItemId = id;
    syncSelectionUi();
    renderNotes();
  }

  function toggleItemSelection(id) {
    selMarkerId = null;
    selDepKey = null;
    selNoteId = null;
    if (selItems.has(id)) selItems.delete(id);
    else selItems.add(id);
    lastSelItemId = id;
    syncSelectionUi();
  }

  function selectItemRange(toId) {
    const vis = visibleItems();
    const toIdx = vis.findIndex((it) => it.id === toId);
    if (toIdx < 0) return;
    const fromIdx = lastSelItemId ? vis.findIndex((it) => it.id === lastSelItemId) : toIdx;
    const lo = Math.min(fromIdx < 0 ? toIdx : fromIdx, toIdx);
    const hi = Math.max(fromIdx < 0 ? toIdx : fromIdx, toIdx);
    selMarkerId = null;
    selDepKey = null;
    selNoteId = null;
    selItems.clear();
    for (let i = lo; i <= hi; i++) selItems.add(vis[i].id);
    syncSelectionUi();
  }

  function selectMarker(id) {
    selItems.clear();
    selDepKey = null;
    selNoteId = null;
    selMarkerId = id;
    syncSelectionUi();
  }

  function selectDependency(key) {
    selItems.clear();
    selMarkerId = null;
    selNoteId = null;
    selDepKey = key;
    syncSelectionUi();
  }

  function selectAll() {
    if (presenting()) return;
    selMarkerId = null;
    selDepKey = null;
    selNoteId = null;
    selItems.clear();
    visibleItems().forEach((it) => selItems.add(it.id));
    syncSelectionUi();
  }

  function syncSelectionUi() {
    els.rows.forEach((row, id) => row.classList.toggle('selected', selItems.has(id)));
    els.bars.forEach((bar, id) => {
      bar.classList.toggle('selected', selItems.has(id));
      bar.classList.toggle('multi-selected', selItems.size > 1 && selItems.has(id));
    });
    if (gridEl) {
      gridEl.querySelectorAll('.gantt-row-bg').forEach((bg) => {
        bg.classList.toggle('is-selected', selItems.has(bg.dataset.rowId));
      });
    }
    els.markers.forEach((rec, id) => {
      const on = selMarkerId === id;
      rec.line.classList.toggle('selected', on);
      rec.flag.classList.toggle('selected', on);
    });
    els.deps.forEach((rec, key) => {
      const on = selDepKey === key;
      rec.g.classList.toggle('selected', on);
      rec.path.classList.toggle('selected', on);
      const dep = (chartData._deps || []).find((d) => depKeyOf(d) === key);
      const url = on ? 'url(#gantt-arr-sel)' : (dep && dep.violated) ? 'url(#gantt-arr-warn)' : 'url(#gantt-arr)';
      rec.path.setAttribute('marker-end', url);
    });
    syncDepSpotlight();
    els.notes.forEach((card, id) => card.classList.toggle('selected', selNoteId === id));
    renderActionBar();
    if (typeof updateDeleteButton === 'function') updateDeleteButton();
  }

  function closeFloatingPop() {
    if (floatingPop) {
      floatingPop.remove();
      floatingPop = null;
    }
  }

  function removeActionBar() {
    closeFloatingPop();
    if (actionBarEl) {
      actionBarEl.remove();
      actionBarEl = null;
    }
  }

  function positionActionBar(anchorEl) {
    if (!actionBarEl || !anchorEl) return;
    const ar = anchorEl.getBoundingClientRect();
    const br = actionBarEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = ar.left + ar.width / 2 - br.width / 2;
    left = Math.max(12, Math.min(vw - br.width - 12, left));
    let top = ar.top - br.height - 10;
    if (top < 56) top = Math.min(vh - br.height - 70, ar.bottom + 10);
    actionBarEl.style.position = 'fixed';
    actionBarEl.style.left = `${Math.round(left)}px`;
    actionBarEl.style.top = `${Math.round(top)}px`;
    actionBarEl.style.zIndex = '60';
  }

  function openMiniPop(anchor, buildFn) {
    closeFloatingPop();
    const pop = htmlEl('div', 'gantt-mini-pop');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('data-export-skip', '');
    pop.addEventListener('pointerdown', (e) => e.stopPropagation());
    buildFn(pop);
    document.body.appendChild(pop);
    floatingPop = pop;
    const ar = anchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    const left = Math.max(12, Math.min(window.innerWidth - pr.width - 12, ar.left));
    let top = ar.bottom + 8;
    if (top + pr.height > window.innerHeight - 12) top = Math.max(12, ar.top - pr.height - 8);
    pop.style.position = 'fixed';
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
    pop.style.zIndex = '70';
  }

  function renderActionBar() {
    removeActionBar();
    if (presenting() || activeDrag) return;

    let anchor = null;
    const bar = ui.actionBar('actionbar gantt-actionbar', 'Selection actions');
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    const pickColor = (current, onPick) => swatchPicker(current || '', onPick, { triggerClass: 'ab-btn', btnClass: 'ab-swatch', act: 'color' });

    if (selMarkerId) {
      const m = markerById(selMarkerId);
      const rec = els.markers.get(selMarkerId);
      if (!m || !rec) return;
      anchor = rec.flag;

      const btnDate = ui.abButton('ab-btn', 'date', ui.icon('calendar', { size: 'sm' }), `Date: ${m.date}`);
      btnDate.addEventListener('click', () => openMarkerDatePop(btnDate, m));

      const swatches = pickColor(m.color, (slot) => {
        if (slot) m.color = slot; else delete m.color;
        render();
        updateStatus(true);
      });

      const btnDel = ui.abButton('ab-btn btn-danger-hover', 'delete', ui.icon('trash', { size: 'sm' }), 'Delete marker');
      btnDel.addEventListener('click', () => deleteSelection());

      bar.append(btnDate, ui.abSep('ab-sep'), swatches, ui.abSep('ab-sep'), btnDel);
    } else if (selDepKey) {
      const dep = depsList().find((d) => depKeyOf(d) === selDepKey);
      const rec = els.deps.get(selDepKey);
      if (!dep || !rec) return;
      anchor = rec.path;

      const curType = dep.type === 'ss' ? 'ss' : 'fs';
      const typeLabel = curType === 'fs' ? 'After finish (FS)' : 'Same start (SS)';
      const nextLabel = curType === 'fs' ? 'Same start (SS)' : 'After finish (FS)';
      const btnType = ui.abButton('ab-btn', 'toggle-type', typeLabel, `Switch to ${nextLabel}`);
      btnType.addEventListener('click', () => {
        dep.type = curType === 'fs' ? 'ss' : 'fs';
        selDepKey = depKeyOf(dep);
        render();
        updateStatus(true);
      });

      const btnRev = ui.abButton('ab-btn', 'reverse', ui.icon('reverse', { size: 'sm' }), 'Reverse dependency');
      btnRev.addEventListener('click', () => {
        if (wouldCreateDepCycle(dep.to, dep.from, dep)) {
          ui.toast('Cannot reverse: would create a dependency cycle');
          return;
        }
        const tmp = dep.from;
        dep.from = dep.to;
        dep.to = tmp;
        selDepKey = depKeyOf(dep);
        render();
        updateStatus(true);
      });

      const btnDel = ui.abButton('ab-btn btn-danger-hover', 'delete', ui.icon('trash', { size: 'sm' }), 'Delete dependency');
      btnDel.addEventListener('click', () => deleteSelection());

      bar.append(btnType, btnRev, ui.abSep('ab-sep'), btnDel);
    } else if (selItems.size === 1) {
      const id = [...selItems][0];
      const it = itemById(id);
      if (!it) return;
      anchor = els.bars.get(id) || els.rows.get(id);
      if (!anchor) return;
      const isParent = Boolean(it._hasChildren || it.kind === 'group');
      const isMilestone = it.kind === 'milestone' && !it._hasChildren;

      if (!isParent) {
        const btnDates = ui.abButton('ab-btn', 'dates', ui.icon('calendar', { size: 'sm' }), isMilestone ? 'Set date' : 'Set dates');
        btnDates.addEventListener('click', () => openItemDatesPop(btnDates, it, isMilestone));
        bar.append(btnDates, ui.abSep('ab-sep'));
      }

      const swatches = pickColor(it.color, (slot) => {
        if (slot) it.color = slot; else delete it.color;
        render();
        updateStatus(true);
      });
      bar.append(swatches, ui.abSep('ab-sep'));

      if (!isMilestone) {
        const btnSub = ui.abButton('ab-btn', 'subtask', ui.icon('plus', { size: 'sm' }), 'Add subtask');
        btnSub.addEventListener('click', () => addSubtask(id));
        bar.append(btnSub);
      }

      const btnConn = ui.abButton('ab-btn', 'connect', ui.icon('link', { size: 'sm' }), 'Connect dependency');
      btnConn.addEventListener('click', () => startClickConnect(id));
      bar.append(btnConn);

      const btnNote = ui.abButton('ab-btn', 'note', ui.icon('note', { size: 'sm' }), noteForTarget(id) ? 'Edit note' : 'Add note');
      btnNote.addEventListener('click', () => addOrEditNoteForTarget(id));
      bar.append(btnNote, ui.abSep('ab-sep'));

      const btnDel = ui.abButton('ab-btn btn-danger-hover', 'delete', ui.icon('trash', { size: 'sm' }), 'Delete');
      btnDel.addEventListener('click', () => deleteSelection(btnDel));
      bar.append(btnDel);
    } else if (selItems.size > 1) {
      const ids = [...selItems];
      anchor = els.bars.get(ids[0]) || els.rows.get(ids[0]);
      if (!anchor) return;

      const countLbl = htmlEl('span', 'gantt-ab-count', `${ids.length} selected`);
      bar.append(countLbl, ui.abSep('ab-sep'));

      const firstColor = (itemById(ids[0]) || {}).color || '';
      const sameColor = ids.every((id) => ((itemById(id) || {}).color || '') === firstColor) ? firstColor : '';
      const swatches = pickColor(sameColor, (slot) => {
        ids.forEach((id) => {
          const it = itemById(id);
          if (!it) return;
          if (slot) it.color = slot; else delete it.color;
        });
        render();
        updateStatus(true);
      });
      bar.append(swatches, ui.abSep('ab-sep'));

      const btnShift = ui.abButton('ab-btn', 'shift', ui.icon('calendar', { size: 'sm' }), 'Shift dates (± days)');
      btnShift.addEventListener('click', () => openShiftDatesPop(btnShift, ids));
      bar.append(btnShift, ui.abSep('ab-sep'));

      const btnDel = ui.abButton('ab-btn btn-danger-hover', 'delete', ui.icon('trash', { size: 'sm' }), 'Delete selected');
      btnDel.addEventListener('click', () => deleteSelection(btnDel));
      bar.append(btnDel);
    } else {
      return;
    }

    document.body.appendChild(bar);
    actionBarEl = bar;
    positionActionBar(anchor);
  }

  // --- POPOVERS FOR ACTION BAR ---
  function openItemDatesPop(anchor, it, isMilestone) {
    openMiniPop(anchor, (pop) => {
      const row1 = htmlEl('label', 'gantt-pop-field');
      row1.append(htmlEl('span', 'gantt-pop-lbl', isMilestone ? 'Date' : 'Start'));
      const inStart = htmlEl('input', 'gantt-pop-input');
      inStart.type = 'date';
      inStart.value = it.start || it._start || getTodayStr();
      row1.append(inStart);
      pop.append(row1);

      let inEnd = null;
      if (!isMilestone) {
        const row2 = htmlEl('label', 'gantt-pop-field');
        row2.append(htmlEl('span', 'gantt-pop-lbl', 'End'));
        inEnd = htmlEl('input', 'gantt-pop-input');
        inEnd.type = 'date';
        inEnd.value = it.end || it._end || inStart.value;
        row2.append(inEnd);
        pop.append(row2);
      }

      const apply = htmlEl('button', 'btn gantt-pop-apply', 'Apply');
      apply.type = 'button';
      apply.addEventListener('click', () => {
        const s = ganttFormatDate(inStart.value);
        if (!s) { ui.toast('Invalid start date'); return; }
        if (isMilestone) {
          it.start = s;
          it.end = s;
        } else {
          const e = ganttFormatDate(inEnd.value);
          if (!e) { ui.toast('Invalid end date'); return; }
          it.start = s;
          it.end = e < s ? s : e;
        }
        closeFloatingPop();
        render();
        updateStatus(true);
      });
      pop.append(apply);
      inStart.focus();
    });
  }

  function openShiftDatesPop(anchor, ids) {
    openMiniPop(anchor, (pop) => {
      const row = htmlEl('label', 'gantt-pop-field');
      row.append(htmlEl('span', 'gantt-pop-lbl', 'Shift days'));
      const input = htmlEl('input', 'gantt-pop-input');
      input.type = 'number';
      input.value = '7';
      input.step = '1';
      row.append(input);

      const btns = htmlEl('div', 'gantt-pop-actions');
      const back = htmlEl('button', 'btn', '← Earlier');
      back.type = 'button';
      const fwd = htmlEl('button', 'btn', 'Later →');
      fwd.type = 'button';
      const doShift = (sign) => {
        const n = Math.abs(Math.trunc(Number(input.value) || 0)) * sign;
        if (!n) return;
        const leaves = collectMovableLeaves(ids);
        leaves.forEach((it) => {
          const s = it.start || it._start;
          const e = it.end || it._end || s;
          it.start = ganttAddDays(s, n);
          it.end = it.kind === 'milestone' ? it.start : ganttAddDays(e, n);
        });
        closeFloatingPop();
        render();
        updateStatus(true);
      };
      back.addEventListener('click', () => doShift(-1));
      fwd.addEventListener('click', () => doShift(1));
      btns.append(back, fwd);
      pop.append(row, btns);
      input.focus();
      input.select();
    });
  }

  function openMarkerRenamePop(anchor, m) {
    openMiniPop(anchor, (pop) => {
      const input = htmlEl('input', 'gantt-pop-input');
      input.type = 'text';
      input.maxLength = LABEL_MAX;
      input.value = m.label || '';
      const apply = htmlEl('button', 'btn gantt-pop-apply', 'Save');
      apply.type = 'button';
      const save = () => {
        m.label = cleanLabel(input.value, 'Milestone');
        closeFloatingPop();
        render();
        updateStatus(true);
      };
      apply.addEventListener('click', save);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeFloatingPop(); }
      });
      pop.append(input, apply);
      input.focus();
      input.select();
    });
  }

  function openMarkerDatePop(anchor, m) {
    openMiniPop(anchor, (pop) => {
      const input = htmlEl('input', 'gantt-pop-input');
      input.type = 'date';
      input.value = m.date || getTodayStr();
      const apply = htmlEl('button', 'btn gantt-pop-apply', 'Save');
      apply.type = 'button';
      apply.addEventListener('click', () => {
        const d = ganttFormatDate(input.value);
        if (!d) { ui.toast('Invalid date'); return; }
        m.date = d;
        closeFloatingPop();
        render();
        updateStatus(true);
      });
      pop.append(input, apply);
      input.focus();
    });
  }

  // --- INLINE RENAME ---
  function startInlineRename(itemId, labelEl) {
    const it = itemById(itemId);
    if (!it || presenting()) return;
    const target = labelEl || (els.rows.get(itemId) && els.rows.get(itemId).querySelector('.gantt-tree-label'));
    if (!target) return;
    const orig = it.label || it.id;
    target.contentEditable = 'true';
    target.classList.add('is-editing');
    target.focus();
    const range = document.createRange();
    range.selectNodeContents(target);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    let done = false;
    const finish = (cancel) => {
      if (done) return;
      done = true;
      target.contentEditable = 'false';
      target.classList.remove('is-editing');
      const next = cancel ? orig : cleanLabel(target.textContent, orig);
      target.textContent = next;
      if (next !== orig) {
        it.label = next;
        render();
        updateStatus(true);
      }
    };
    target.addEventListener('blur', () => finish(false), { once: true });
    target.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); target.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(true); }
    });
  }

  // --- COLLAPSE / EXPAND ---
  function toggleCollapse(itemId) {
    const it = itemById(itemId);
    if (!it) return;
    if (it.collapsed) delete it.collapsed;
    else it.collapsed = true;
    render();
    if (!presenting()) updateStatus(true);
  }

  function toggleCollapseAll() {
    const parents = parentItems();
    if (!parents.length) return;
    const anyExpanded = parents.some((it) => !it.collapsed);
    parents.forEach((it) => {
      if (anyExpanded) it.collapsed = true;
      else delete it.collapsed;
    });
    render();
    if (!presenting()) updateStatus(true);
  }

  // --- ADD / DELETE ---
  function defaultNewDates(parentId) {
    const p = parentId ? itemById(parentId) : null;
    if (p && p._start) {
      return { start: p._start, end: ganttAddDays(p._start, 13) };
    }
    const selId = selItems.size ? [...selItems][0] : null;
    const selIt = selId ? itemById(selId) : null;
    if (selIt && selIt._end) {
      const s = ganttAddDays(selIt._end, 1);
      return { start: s, end: ganttAddDays(s, 13) };
    }
    const base = (chartData._range && (chartData._range.contentStart || chartData._range.start))
      ? ganttAddDays(chartData._range.contentStart || chartData._range.start, 7)
      : getTodayStr();
    return { start: base, end: ganttAddDays(base, 13) };
  }

  function addTask(parentId, opts) {
    if (presenting()) return;
    if (!Array.isArray(chartData.items)) chartData.items = [];
    const o = opts || {};
    const def = defaultNewDates(parentId);
    const start = o.start || def.start;
    const end = o.end || (o.start ? ganttAddDays(o.start, 13) : def.end);
    const it = { id: newId('t'), kind: 'task', label: 'New task', start, end };
    if (parentId) {
      const p = itemById(parentId);
      if (p) {
        it.parent = p.id;
        if (p.collapsed) delete p.collapsed;
      }
    }
    chartData.items.push(it);
    selectSingleItem(it.id);
    render();
    updateStatus(true);
    const row = els.rows.get(it.id);
    if (row) startInlineRename(it.id, row.querySelector('.gantt-tree-label'));
  }

  function addSubtask(parentId, opts) {
    const pid = parentId || (selItems.size === 1 ? [...selItems][0] : null);
    const p = pid ? itemById(pid) : null;
    if (p && p.kind === 'milestone') {
      ui.toast('Milestones cannot have subtasks');
      return;
    }
    addTask(p ? p.id : null, opts);
  }

  function addMilestone(opts) {
    if (presenting()) return;
    if (!Array.isArray(chartData.items)) chartData.items = [];
    const o = opts || {};
    const pid = o.parentId !== undefined ? o.parentId : (selItems.size === 1 ? [...selItems][0] : null);
    const p = pid ? itemById(pid) : null;
    const d = o.date || ((p && p._end) ? p._end : defaultNewDates(null).start);
    const it = { id: newId('t'), kind: 'milestone', label: 'Milestone', start: d, end: d };
    if (p && p.kind !== 'milestone') {
      it.parent = p.id;
      if (p.collapsed) delete p.collapsed;
    }
    chartData.items.push(it);
    selectSingleItem(it.id);
    render();
    updateStatus(true);
    const row = els.rows.get(it.id);
    if (row) startInlineRename(it.id, row.querySelector('.gantt-tree-label'));
  }

  function addVerticalMarker(opts) {
    if (presenting()) return;
    if (!Array.isArray(chartData.markers)) chartData.markers = [];
    const o = opts || {};
    const range = chartData._range;
    const midDate = o.date || (range
      ? ganttAddDays(range.contentStart || range.start, Math.floor(Math.min(range.totalDays, 60) / 2))
      : getTodayStr());
    const m = { id: newId('m'), label: 'Milestone', date: midDate, color: '4' };
    chartData.markers.push(m);
    selectMarker(m.id);
    render();
    updateStatus(true);
  }

  function deleteSelection() {
    if (presenting()) return;
    if (selNoteId) {
      removeNote(selNoteId, true);
      return;
    }
    if (selMarkerId) {
      chartData.markers = markersList().filter((m) => m && m.id !== selMarkerId);
      if (!chartData.markers.length) delete chartData.markers;
      selMarkerId = null;
      render();
      updateStatus(true);
      return;
    }
    if (selDepKey) {
      chartData.dependencies = depsList().filter((d) => depKeyOf(d) !== selDepKey);
      selDepKey = null;
      render();
      updateStatus(true);
      return;
    }
    if (!selItems.size) return;

    const toRemove = new Set(selItems);
    selItems.forEach((id) => {
      getDescendants(id).forEach((ch) => toRemove.add(ch.id));
    });
    chartData.items = itemsList().filter((it) => it && !toRemove.has(it.id));
    chartData.dependencies = depsList().filter((d) => d && !toRemove.has(d.from) && !toRemove.has(d.to));
    if (Array.isArray(chartData.notes)) {
      chartData.notes = chartData.notes.filter((n) => n && !toRemove.has(n.target));
      if (!chartData.notes.length) delete chartData.notes;
    }
    selItems.clear();
    lastSelItemId = null;
    render();
    updateStatus(true);
  }

  // --- POINTER INTERACTIONS: BAR DRAG, RESIZE, MULTI-SELECT MOVE ---
  function onBarPointerDown(e, it) {
    if (e.button !== 0) return;
    e.stopPropagation();

    // If we are in click-to-connect mode, finish connection
    if (connectState && !connectState.pointerDrag) {
      finishConnection(connectState.fromId, it.id, connectState.type);
      connectState = null;
      if (root) root.classList.remove('is-connecting');
      return;
    }

    if (e.shiftKey) {
      selectItemRange(it.id);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      toggleItemSelection(it.id);
      return;
    }
    if (!selItems.has(it.id)) {
      selectSingleItem(it.id);
    }

    if (presenting()) return;

    const leaves = collectMovableLeaves(selItems.has(it.id) ? [...selItems] : [it.id]);
    if (!leaves.length) return;

    const range = chartData._range;
    const snapDays = GANTT_ZOOMS[currentZoom()].snapDays;
    const origDates = leaves.map((leaf) => ({
      item: leaf,
      start: leaf.start || leaf._start,
      end: leaf.end || leaf._end || leaf.start || leaf._start
    }));

    activeDrag = {
      kind: 'move',
      startX: e.clientX,
      pxPerDay: range.pxPerDay,
      snapDays,
      origDates,
      primary: it,
      lastDelta: 0,
      moved: false
    };

    const onMove = (ev) => {
      if (!activeDrag || activeDrag.kind !== 'move') return;
      const dx = ev.clientX - activeDrag.startX;
      if (!activeDrag.moved && Math.abs(dx) < 4) return;
      if (!activeDrag.moved) {
        activeDrag.moved = true;
        removeActionBar();
        if (root) root.classList.add('is-dragging');
      }
      const rawDays = dx / activeDrag.pxPerDay;
      const snapped = Math.round(rawDays / activeDrag.snapDays) * activeDrag.snapDays;
      if (snapped === activeDrag.lastDelta) {
        if (activeDrag.tipText) showDragTip(ev.clientX, ev.clientY, activeDrag.tipText);
        return;
      }
      activeDrag.lastDelta = snapped;
      activeDrag.origDates.forEach(({ item, start, end }) => {
        item.start = ganttAddDays(start, snapped);
        item.end = item.kind === 'milestone' ? item.start : ganttAddDays(end, snapped);
      });
      updateLiveGeometry();
      const tip = activeDrag.origDates.length > 1
        ? `${activeDrag.origDates.length} tasks · ${snapped >= 0 ? '+' : ''}${snapped}d`
        : formatDateRange(activeDrag.primary._start, activeDrag.primary._end);
      activeDrag.tipText = tip;
      showDragTip(ev.clientX, ev.clientY, tip);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const d = activeDrag;
      activeDrag = null;
      hideDragTip();
      if (root) root.classList.remove('is-dragging');
      if (d && d.moved && d.lastDelta !== 0) {
        render();
        updateStatus(true);
      } else {
        renderActionBar();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function onResizePointerDown(e, it, edge) {
    if (e.button !== 0 || presenting()) return;
    e.stopPropagation();
    selectSingleItem(it.id);

    const range = chartData._range;
    const snapDays = GANTT_ZOOMS[currentZoom()].snapDays;
    const origStart = it.start || it._start;
    const origEnd = it.end || it._end || origStart;

    activeDrag = {
      kind: 'resize',
      edge,
      item: it,
      startX: e.clientX,
      pxPerDay: range.pxPerDay,
      snapDays,
      origStart,
      origEnd,
      lastDelta: 0,
      moved: false
    };

    const onMove = (ev) => {
      if (!activeDrag || activeDrag.kind !== 'resize') return;
      const dx = ev.clientX - activeDrag.startX;
      if (!activeDrag.moved && Math.abs(dx) < 3) return;
      if (!activeDrag.moved) {
        activeDrag.moved = true;
        removeActionBar();
        if (root) root.classList.add('is-dragging');
      }
      const rawDays = dx / activeDrag.pxPerDay;
      const snapped = Math.round(rawDays / activeDrag.snapDays) * activeDrag.snapDays;
      if (snapped === activeDrag.lastDelta) {
        if (activeDrag.tipText) showDragTip(ev.clientX, ev.clientY, activeDrag.tipText);
        return;
      }
      activeDrag.lastDelta = snapped;
      if (edge === 'start') {
        const nextStart = ganttAddDays(origStart, snapped);
        it.start = nextStart > origEnd ? origEnd : nextStart;
      } else {
        const nextEnd = ganttAddDays(origEnd, snapped);
        it.end = nextEnd < origStart ? origStart : nextEnd;
      }
      updateLiveGeometry();
      const tip = formatDateRange(it._start, it._end);
      activeDrag.tipText = tip;
      showDragTip(ev.clientX, ev.clientY, tip);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const d = activeDrag;
      activeDrag = null;
      hideDragTip();
      if (root) root.classList.remove('is-dragging');
      if (d && d.moved && d.lastDelta !== 0) {
        render();
        updateStatus(true);
      } else {
        renderActionBar();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  // --- VERTICAL MARKER DRAG ---
  function onMarkerPointerDown(e, markerId) {
    if (e.button !== 0 || presenting()) return;
    e.stopPropagation();
    selectMarker(markerId);
    const m = markerById(markerId);
    if (!m) return;

    const range = chartData._range;
    const snapDays = GANTT_ZOOMS[currentZoom()].snapDays;
    const origDate = m.date;

    activeDrag = {
      kind: 'marker',
      marker: m,
      startX: e.clientX,
      pxPerDay: range.pxPerDay,
      snapDays,
      origDate,
      lastDelta: 0,
      moved: false
    };

    const onMove = (ev) => {
      if (!activeDrag || activeDrag.kind !== 'marker') return;
      const dx = ev.clientX - activeDrag.startX;
      if (!activeDrag.moved && Math.abs(dx) < 3) return;
      if (!activeDrag.moved) {
        activeDrag.moved = true;
        removeActionBar();
      }
      const snapped = Math.round((dx / activeDrag.pxPerDay) / activeDrag.snapDays) * activeDrag.snapDays;
      if (snapped === activeDrag.lastDelta) {
        showDragTip(ev.clientX, ev.clientY, `${m.label || 'Marker'} · ${formatShortDate(m.date)}`);
        return;
      }
      activeDrag.lastDelta = snapped;
      m.date = ganttAddDays(origDate, snapped);
      updateLiveGeometry();
      showDragTip(ev.clientX, ev.clientY, `${m.label || 'Marker'} · ${formatShortDate(m.date)}`);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const d = activeDrag;
      activeDrag = null;
      hideDragTip();
      if (d && d.moved && d.lastDelta !== 0) {
        render();
        updateStatus(true);
      } else {
        renderActionBar();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  // --- DEPENDENCY CONNECTION (DRAG FROM PORT OR CLICK CONNECT) ---
  function startClickConnect(fromId) {
    connectState = { fromId, type: 'fs', pointerDrag: false };
    removeActionBar();
    if (root) root.classList.add('is-connecting');
    ui.toast('Click a target task or milestone to connect (Esc to cancel)');
  }

  function finishConnection(fromId, toId, type) {
    if (!fromId || !toId) return;
    if (fromId === toId) {
      ui.toast('Cannot connect an item to itself');
      return;
    }
    const depType = type === 'ss' ? 'ss' : 'fs';
    if (depsList().some((d) => d && d.from === fromId && d.to === toId && (d.type === 'ss' ? 'ss' : 'fs') === depType)) {
      ui.toast('That dependency already exists');
      return;
    }
    if (wouldCreateDepCycle(fromId, toId)) {
      ui.toast('Cannot connect: would create a dependency cycle');
      return;
    }
    if (!Array.isArray(chartData.dependencies)) chartData.dependencies = [];
    chartData.dependencies.push({ from: fromId, to: toId, type: depType });
    render();
    updateStatus(true);
  }

  function onPortPointerDown(e, fromId, depType) {
    if (e.button !== 0 || presenting()) return;
    e.stopPropagation();
    const svg = ensureDepsSvg();
    const fromIt = itemById(fromId);
    if (!svg || !fromIt || !fromIt._bar) return;

    removeActionBar();
    connectState = { fromId, type: depType, pointerDrag: true };
    const fb = fromIt._bar;
    const sx = depType === 'ss' ? fb.x : fb.x + fb.w;
    const sy = fb.y + fb.h / 2;
    const modeLabel = depType === 'ss' ? 'Same start' : 'After finish';
    let hoveredTargetEl = null;

    const clearDepTarget = () => {
      if (hoveredTargetEl) {
        hoveredTargetEl.classList.remove('is-dep-target');
        hoveredTargetEl = null;
      }
    };

    const preview = svgEl('path', {
      class: 'gantt-dep-preview',
      fill: 'none',
      d: `M ${sx} ${sy} L ${sx} ${sy}`
    });
    svg.appendChild(preview);
    showDragTip(e.clientX, e.clientY, modeLabel);

    const onMove = (ev) => {
      const bodyRect = bodyEl.getBoundingClientRect();
      const tx = ev.clientX - bodyRect.left;
      const ty = ev.clientY - bodyRect.top;
      const mx = Math.round((sx + tx) / 2);
      preview.setAttribute('d', `M ${sx} ${sy} L ${mx} ${sy} L ${mx} ${ty} L ${tx} ${ty}`);

      const hitEl = document.elementFromPoint(ev.clientX, ev.clientY);
      const targetEl = hitEl && hitEl.closest('.gantt-bar, .gantt-milestone');
      if (targetEl && targetEl.dataset.itemId && targetEl.dataset.itemId !== fromId) {
        if (hoveredTargetEl !== targetEl) {
          clearDepTarget();
          hoveredTargetEl = targetEl;
          hoveredTargetEl.classList.add('is-dep-target');
        }
      } else {
        clearDepTarget();
      }
      showDragTip(ev.clientX, ev.clientY, modeLabel);
    };

    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      preview.remove();
      clearDepTarget();
      hideDragTip();
      const st = connectState;
      connectState = null;
      const hitEl = document.elementFromPoint(ev.clientX, ev.clientY);
      const targetBar = hitEl && (hitEl.closest('.gantt-bar, .gantt-milestone') || hitEl.closest('[data-item-id]'));
      if (st && targetBar && targetBar.dataset.itemId) {
        finishConnection(st.fromId, targetBar.dataset.itemId, st.type);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  // --- MARQUEE SELECTION & EMPTY GRID PAN ---
  if (bodyEl) {
    bodyEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.gantt-bar, .gantt-milestone, .gantt-marker-line, .gantt-dep-group, .note')) return;

      if (connectState) {
        cancelInteraction();
        return;
      }

      // Shift+drag draws selection marquee
      if (e.shiftKey && !presenting() && marqueeEl) {
        e.preventDefault();
        const bodyRect = bodyEl.getBoundingClientRect();
        const startX = e.clientX - bodyRect.left;
        const startY = e.clientY - bodyRect.top;
        marqueeEl.hidden = false;
        marqueeEl.style.left = `${startX}px`;
        marqueeEl.style.top = `${startY}px`;
        marqueeEl.style.width = '0px';
        marqueeEl.style.height = '0px';

        // Cache bar rects once on pointerdown
        const barBoxes = [];
        els.bars.forEach((el, id) => {
          const it = itemById(id);
          if (it && it._bar) barBoxes.push({ id, b: it._bar });
        });

        activeDrag = { kind: 'marquee' };

        const onMove = (ev) => {
          const curX = ev.clientX - bodyRect.left;
          const curY = ev.clientY - bodyRect.top;
          const x = Math.min(startX, curX);
          const y = Math.min(startY, curY);
          const w = Math.abs(curX - startX);
          const h = Math.abs(curY - startY);
          marqueeEl.style.left = `${x}px`;
          marqueeEl.style.top = `${y}px`;
          marqueeEl.style.width = `${w}px`;
          marqueeEl.style.height = `${h}px`;

          selItems.clear();
          selMarkerId = null;
          selDepKey = null;
          selNoteId = null;
          barBoxes.forEach(({ id, b }) => {
            if (b.x < x + w && b.x + b.w > x && b.y < y + h && b.y + b.h > y) {
              selItems.add(id);
            }
          });
          syncSelectionUi();
        };

        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          marqueeEl.hidden = true;
          activeDrag = null;
          syncSelectionUi();
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        return;
      }

      // Click/drag on empty grid: clear selection, drag pans timeline horizontally
      clearSelection();
      if (!timeline) return;
      const startX = e.clientX;
      const startScroll = timeline.scrollLeft;
      const onMove = (ev) => {
        timeline.scrollLeft = startScroll - (ev.clientX - startX);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }

  // --- SIDEBAR ROW DRAG (REORDER / REPARENT) ---
  function onSidebarRowPointerDown(e, it) {
    if (e.button !== 0) return;
    if (e.target.closest('button') || e.target.isContentEditable) return;
    e.stopPropagation();

    if (e.shiftKey) { selectItemRange(it.id); return; }
    if (e.ctrlKey || e.metaKey) { toggleItemSelection(it.id); return; }
    selectSingleItem(it.id);
    if (presenting()) return;

    const startY = e.clientY;
    let dragging = false;
    let dropTarget = null;
    let dropMode = null; // 'before' | 'after' | 'inside'

    const clearDropIndicators = () => {
      els.rows.forEach((r) => r.classList.remove('drop-before', 'drop-after', 'drop-inside', 'is-row-dragging'));
    };

    const onMove = (ev) => {
      if (!dragging && Math.abs(ev.clientY - startY) < 6) return;
      if (!dragging) {
        dragging = true;
        removeActionBar();
        const srcRow = els.rows.get(it.id);
        if (srcRow) srcRow.classList.add('is-row-dragging');
      }
      clearDropIndicators();
      const srcRow = els.rows.get(it.id);
      if (srcRow) srcRow.classList.add('is-row-dragging');

      dropTarget = null;
      dropMode = null;
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const targetRow = hit && hit.closest('.gantt-tree-row');
      if (!targetRow) return;
      const tid = targetRow.dataset.itemId;
      if (!tid || tid === it.id || isAncestor(it.id, tid)) return;

      const r = targetRow.getBoundingClientRect();
      const rel = (ev.clientY - r.top) / Math.max(1, r.height);
      const targetItem = itemById(tid);
      if (rel < 0.28) {
        dropMode = 'before';
        targetRow.classList.add('drop-before');
      } else if (rel > 0.72) {
        dropMode = 'after';
        targetRow.classList.add('drop-after');
      } else if (targetItem && targetItem.kind !== 'milestone') {
        dropMode = 'inside';
        targetRow.classList.add('drop-inside');
      } else {
        dropMode = 'after';
        targetRow.classList.add('drop-after');
      }
      dropTarget = tid;
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      clearDropIndicators();
      if (dragging && dropTarget && dropMode) {
        reorderOrReparent(it.id, dropTarget, dropMode);
      } else {
        renderActionBar();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function reorderOrReparent(sourceId, targetId, mode) {
    if (sourceId === targetId || isAncestor(sourceId, targetId)) return;
    const src = itemById(sourceId);
    const tgt = itemById(targetId);
    if (!src || !tgt) return;

    const list = itemsList();
    const srcIdx = list.indexOf(src);
    if (srcIdx < 0) return;

    if (mode === 'inside') {
      if (tgt.kind === 'milestone') return;
      src.parent = tgt.id;
      if (tgt.collapsed) delete tgt.collapsed;
    } else {
      if (tgt.parent) src.parent = tgt.parent;
      else delete src.parent;
    }

    list.splice(srcIdx, 1);
    const newTgtIdx = list.indexOf(tgt);
    if (mode === 'before') list.splice(newTgtIdx, 0, src);
    else list.splice(newTgtIdx + 1, 0, src);

    render();
    updateStatus(true);
  }

  function siblingIndices(itemId) {
    const list = itemsList();
    const it = itemById(itemId);
    if (!it) return { indices: [], pos: -1 };
    const pid = it.parent || '';
    const indices = [];
    list.forEach((x, idx) => {
      if (x && (x.parent || '') === pid) indices.push(idx);
    });
    const pos = indices.findIndex((idx) => list[idx] === it);
    return { indices, pos };
  }

  function moveItemSibling(itemId, delta) {
    if (presenting()) return;
    const list = itemsList();
    const { indices, pos } = siblingIndices(itemId);
    const nextPos = pos + delta;
    if (pos < 0 || nextPos < 0 || nextPos >= indices.length) return;
    const a = indices[pos];
    const b = indices[nextPos];
    const tmp = list[a];
    list[a] = list[b];
    list[b] = tmp;
    render();
    updateStatus(true);
  }

  // --- SIDEBAR SPLITTER DRAG & DOUBLE-CLICK AUTO-FIT ---
  function autoFitSidebarWidth() {
    if (!treeEl) return;
    let maxW = 200;
    treeEl.querySelectorAll('.gantt-tree-row').forEach((row) => {
      const lbl = row.querySelector('.gantt-tree-label');
      if (!lbl) return;
      const needed = Math.ceil((lbl.offsetLeft || 44) + lbl.scrollWidth + 36);
      if (needed > maxW) maxW = needed;
    });
    applySidebarWidth(Math.max(200, Math.min(480, maxW)));
  }

  if (splitter) {
    splitter.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = sidebarWidth;
      splitter.classList.add('is-dragging');

      const onMove = (ev) => {
        applySidebarWidth(startW + (ev.clientX - startX));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        splitter.classList.remove('is-dragging');
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
    splitter.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      autoFitSidebarWidth();
    });
  }

  // --- SCROLL SYNCHRONIZATION & AUTO-EXTENDING TIMELINE ---
  let suppressExtendUntil = 0;
  function maybeExtendTimeline() {
    if (isExtendingTimeline || activeDrag || !timeline || !chartData._range) return;
    if (performance.now() < suppressExtendUntil) return;
    if (timeline.scrollWidth <= timeline.clientWidth) return;
    const range = chartData._range;
    const step = EXTEND_DAYS[currentZoom()] || 180;

    if (timeline.scrollLeft < 120) {
      const oldStart = range.start;
      const baseStart = (chartData._extraStart && chartData._extraStart < oldStart) ? chartData._extraStart : oldStart;
      chartData._extraStart = ganttAddDays(baseStart, -step);
      isExtendingTimeline = true;
      const prevScrollLeft = timeline.scrollLeft;
      const prevScrollTop = timeline.scrollTop;
      render();
      const newStart = chartData._range ? chartData._range.start : oldStart;
      const addedDays = ganttDiffDays(newStart, oldStart);
      const deltaPx = addedDays > 0 ? Math.round(addedDays * chartData._range.pxPerDay) : 0;
      isSyncingScroll = true;
      timeline.scrollLeft = prevScrollLeft + deltaPx;
      timeline.scrollTop = prevScrollTop;
      if (treeEl) treeEl.scrollTop = prevScrollTop;
      isSyncingScroll = false;
      requestAnimationFrame(() => { isExtendingTimeline = false; });
    } else if (timeline.scrollLeft + timeline.clientWidth > timeline.scrollWidth - 120) {
      const oldEnd = range.end;
      const baseEnd = (chartData._extraEnd && chartData._extraEnd > oldEnd) ? chartData._extraEnd : oldEnd;
      chartData._extraEnd = ganttAddDays(baseEnd, step);
      isExtendingTimeline = true;
      const prevScrollLeft = timeline.scrollLeft;
      const prevScrollTop = timeline.scrollTop;
      render();
      isSyncingScroll = true;
      timeline.scrollLeft = prevScrollLeft;
      timeline.scrollTop = prevScrollTop;
      if (treeEl) treeEl.scrollTop = prevScrollTop;
      isSyncingScroll = false;
      requestAnimationFrame(() => { isExtendingTimeline = false; });
    }
  }

  if (timeline && treeEl) {
    timeline.addEventListener('scroll', () => {
      if (!isSyncingScroll) {
        isSyncingScroll = true;
        if (treeEl.scrollTop !== timeline.scrollTop) treeEl.scrollTop = timeline.scrollTop;
        if (actionBarEl) removeActionBar();
        isSyncingScroll = false;
      }
      maybeExtendTimeline();
    }, { passive: true });

    treeEl.addEventListener('scroll', () => {
      if (isSyncingScroll) return;
      isSyncingScroll = true;
      if (timeline.scrollTop !== treeEl.scrollTop) timeline.scrollTop = treeEl.scrollTop;
      if (actionBarEl) removeActionBar();
      isSyncingScroll = false;
    }, { passive: true });
  }

  // --- ZOOM CONTROLLER & MORPH TRANSITION ("morph, not fade") ---
  function captureBarRects() {
    const map = new Map();
    els.bars.forEach((el, id) => {
      map.set(id, el.getBoundingClientRect());
    });
    return map;
  }

  function playZoomMorph(oldRects) {
    if (!motion.enabled() || !oldRects || !oldRects.size) return;
    const dur = motion.dur('dur-base', 200);
    const easing = motion.curve('curve-out');
    els.bars.forEach((el, id) => {
      const prev = oldRects.get(id);
      if (!prev) return;
      const next = el.getBoundingClientRect();
      if (!next.width || !next.height) return;
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      const sx = prev.width / next.width;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01) return;
      motion.anim(el, [
        { transformOrigin: 'left center', transform: `translate(${dx}px, ${dy}px) scaleX(${sx})` },
        { transformOrigin: 'left center', transform: 'none' }
      ], { duration: dur, easing });
    });
  }

  function setZoomPreset(nextZoom) {
    if (!Object.prototype.hasOwnProperty.call(GANTT_ZOOMS, nextZoom)) return;
    const prevZoom = currentZoom();
    if (prevZoom === nextZoom) return;

    // 1. Anchor viewport center date before changing zoom
    const prevRange = chartData._range;
    let centerDate = null;
    if (timeline && prevRange) {
      const centerPx = timeline.scrollLeft + timeline.clientWidth / 2;
      const dayOffset = Math.round(centerPx / prevRange.pxPerDay);
      centerDate = ganttAddDays(prevRange.start, dayOffset);
    }

    // 2. Capture old bar rects for FLIP morph
    const oldRects = motion.enabled() ? captureBarRects() : null;

    // 3. Apply new zoom & re-render
    chartData.zoom = nextZoom;
    render();

    // 4. Restore scroll position to keep centerDate anchored
    if (timeline && centerDate && chartData._range) {
      const newCenterPx = ganttDiffDays(chartData._range.start, centerDate) * chartData._range.pxPerDay;
      isExtendingTimeline = true;
      timeline.scrollTo({ left: Math.max(0, Math.round(newCenterPx - timeline.clientWidth / 2)), behavior: 'instant' });
      requestAnimationFrame(() => { isExtendingTimeline = false; });
    }

    // 5. Morph bars from old rects to new rects
    if (oldRects) playZoomMorph(oldRects);
    if (!presenting()) updateStatus(true);
  }

  const zoomController = {
    zoomIn() {
      const idx = ZOOM_ORDER.indexOf(currentZoom());
      if (idx > 0) setZoomPreset(ZOOM_ORDER[idx - 1]);
    },
    zoomOut() {
      const idx = ZOOM_ORDER.indexOf(currentZoom());
      if (idx >= 0 && idx < ZOOM_ORDER.length - 1) setZoomPreset(ZOOM_ORDER[idx + 1]);
    },
    reset(animate) {
      // Pick the finest zoom preset where the roadmap content fits inside the visible timeline width
      const availW = (timeline && timeline.clientWidth) ? timeline.clientWidth - 24 : 900;
      const range = chartData._range;
      const contentDays = (range && range.contentStart && range.contentEnd)
        ? Math.max(1, ganttDiffDays(range.contentStart, range.contentEnd) + 14)
        : (range ? range.totalDays : 90);
      let chosen = 'month';
      if (contentDays > 0) {
        chosen = 'year';
        for (let i = 0; i < ZOOM_ORDER.length; i++) {
          const z = ZOOM_ORDER[i];
          if (contentDays * GANTT_ZOOMS[z].pxPerDay <= availW) {
            chosen = z;
            break;
          }
        }
      }
      const scrollToContent = () => {
        if (!timeline || !chartData._range) return;
        const r = chartData._range;
        const anchorDate = r.contentStart || r.start;
        const anchorX = ganttDiffDays(r.start, anchorDate) * r.pxPerDay;
        const left = Math.max(0, Math.round(anchorX - 48));
        isExtendingTimeline = true;
        timeline.scrollTo({ left, top: 0, behavior: (animate && motion.enabled()) ? 'smooth' : 'auto' });
        requestAnimationFrame(() => { isExtendingTimeline = false; });
      };
      if (chosen !== currentZoom()) {
        const oldRects = (animate && motion.enabled()) ? captureBarRects() : null;
        chartData.zoom = chosen;
        render();
        scrollToContent();
        if (oldRects) playZoomMorph(oldRects);
      } else {
        scrollToContent();
      }
    },
    getLabel() {
      return (GANTT_ZOOMS[currentZoom()] || GANTT_ZOOMS.month).label;
    }
  };

  // --- JUMP TO TODAY ---
  function jumpToToday() {
    if (!timeline || !chartData._range) return;
    const todayStr = getTodayStr();
    const range = chartData._range;
    const x = (ganttDiffDays(range.start, todayStr) + 0.5) * range.pxPerDay;
    const targetScroll = Math.max(0, Math.round(x - timeline.clientWidth / 2));
    suppressExtendUntil = performance.now() + 700;
    timeline.scrollTo({
      left: targetScroll,
      behavior: motion.enabled() ? 'smooth' : 'auto'
    });
    if (todayStr < range.start || todayStr > range.end) {
      ui.toast(`Today (${todayStr}) is outside the current roadmap range`);
    }
  }

  // --- HOLIDAYS POPOVER ---
  function renderHolidaysList() {
    if (!holidaysList) return;
    holidaysList.textContent = '';
    const list = holidaysListData();
    if (!list.length) {
      holidaysList.appendChild(htmlEl('div', 'gantt-hol-empty', 'No holidays configured.'));
      return;
    }
    const edit = !presenting();
    list.forEach((h, idx) => {
      const row = htmlEl('div', 'gantt-hol-row');
      const info = htmlEl('div', 'gantt-hol-info');
      const span = h.end && h.end !== h.date ? `${h.date} .. ${h.end}` : h.date;
      info.append(
        htmlEl('span', 'gantt-hol-date', span),
        htmlEl('span', 'gantt-hol-name', h.country ? `${h.name || 'Holiday'} (${h.country})` : (h.name || 'Holiday'))
      );
      row.appendChild(info);
      if (edit) {
        const del = htmlEl('button', 'gantt-hol-del btn-danger-hover');
        del.type = 'button';
        del.title = 'Remove holiday';
        del.setAttribute('aria-label', `Remove ${h.name || h.date}`);
        del.innerHTML = ui.icon('close', { size: 'xs', bold: true });
        del.addEventListener('click', () => {
          chartData.holidays.splice(idx, 1);
          if (!chartData.holidays.length) delete chartData.holidays;
          render();
          updateStatus(true);
        });
        row.appendChild(del);
      }
      holidaysList.appendChild(row);
    });
  }

  function toggleHolidaysPop(force) {
    if (!holidaysPop) return;
    const show = typeof force === 'boolean' ? force : holidaysPop.hidden;
    holidaysPop.hidden = !show;
    if (btnHolidays) btnHolidays.setAttribute('aria-expanded', String(show));
    if (show) renderHolidaysList();
  }

  if (btnHolidays) {
    btnHolidays.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleHolidaysPop();
    });
  }
  if (holCloseBtn) {
    holCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleHolidaysPop(false);
    });
  }
  if (holAddBtn) {
    holAddBtn.addEventListener('click', () => {
      if (presenting()) return;
      const start = holDateInput ? ganttFormatDate(holDateInput.value) : '';
      if (!start) { ui.toast('Pick a valid holiday start date'); return; }
      const endInput = holEndInput || document.getElementById('gantt-hol-end');
      const rawEnd = endInput && endInput.value ? ganttFormatDate(endInput.value) : '';
      if (endInput && endInput.value && !rawEnd) { ui.toast('Pick a valid holiday end date'); return; }
      const end = rawEnd || start;
      if (end < start) { ui.toast('End date must be on or after start date'); return; }
      const name = cleanLabel(holNameInput ? holNameInput.value : '', 'Holiday');
      if (!Array.isArray(chartData.holidays)) chartData.holidays = [];
      if (chartData.holidays.some((h) => h && h.date === start && (h.end || h.date) === end && h.name === name)) {
        ui.toast('Holiday already listed');
        return;
      }
      chartData.holidays.push({ date: start, end, name });
      chartData.holidays.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      if (holDateInput) holDateInput.value = '';
      if (endInput) endInput.value = '';
      if (holNameInput) holNameInput.value = '';
      render();
      updateStatus(true);
    });
  }

  // --- TOOLBAR BUTTON WIRING (+ DRAG-FROM-ADD TILES) ---
  function wireAddTileDrag(btn, kind, label, onClickFn) {
    if (!btn) return;
    let suppressClick = false;
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || presenting()) return;
      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      let ghost = null;

      const isOverTimeline = (cx, cy) => {
        if (!timeline) return false;
        const r = timeline.getBoundingClientRect();
        return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
      };

      const onMove = (ev) => {
        if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) <= 6) return;
        if (!dragging) {
          dragging = true;
          const wrap = addPop && addPop.closest('[data-dock-pop]');
          if (wrap) wrap.classList.remove('open');
          if (btnAdd) btnAdd.setAttribute('aria-expanded', 'false');
          document.body.classList.add('palette-dragging');
          ghost = htmlEl('div', 'gantt-add-ghost', label);
          ghost.setAttribute('data-export-skip', '');
          document.body.appendChild(ghost);
        }
        ghost.style.left = `${ev.clientX + 12}px`;
        ghost.style.top = `${ev.clientY - 14}px`;
        if (isOverTimeline(ev.clientX, ev.clientY)) {
          const dropDate = dateFromClientX(ev.clientX);
          const rowItem = itemFromClientY(ev.clientY);
          ghost.textContent = `${label} · ${formatShortDate(dropDate)}`;
          setHoveredRow(rowItem ? rowItem.id : null);
        } else {
          ghost.textContent = label;
          setHoveredRow(null);
        }
      };

      const onUp = (ev) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (ghost) { ghost.remove(); ghost = null; }
        document.body.classList.remove('palette-dragging');
        setHoveredRow(null);
        if (!dragging) return;
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 0);
        if (ev.type !== 'pointerup' || !isOverTimeline(ev.clientX, ev.clientY)) return;
        const dropDate = dateFromClientX(ev.clientX);
        const rowItem = itemFromClientY(ev.clientY);
        if (kind === 'task') {
          const parentId = (rowItem && (rowItem._hasChildren || rowItem.kind === 'group'))
            ? rowItem.id
            : (rowItem && rowItem.parent ? rowItem.parent : null);
          addTask(parentId, { start: dropDate, end: ganttAddDays(dropDate, 13) });
        } else if (kind === 'subtask') {
          const parentId = (rowItem && rowItem.kind !== 'milestone')
            ? rowItem.id
            : (selItems.size === 1 ? [...selItems][0] : null);
          addSubtask(parentId, { start: dropDate, end: ganttAddDays(dropDate, 13) });
        } else if (kind === 'milestone') {
          const parentId = (rowItem && rowItem.kind !== 'milestone') ? rowItem.id : null;
          addMilestone({ date: dropDate, parentId });
        } else if (kind === 'marker') {
          addVerticalMarker({ date: dropDate });
        } else if (kind === 'note') {
          const targetId = rowItem ? rowItem.id : (selItems.size ? [...selItems][0] : null);
          addOrEditNoteForTarget(targetId);
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });

    btn.addEventListener('click', () => {
      if (suppressClick) { suppressClick = false; return; }
      onClickFn();
    });
  }

  wireAddTileDrag(btnAddTask, 'task', 'Task', () => addTask(null));
  wireAddTileDrag(btnAddSubtask, 'subtask', 'Subtask', () => addSubtask(null));
  wireAddTileDrag(btnAddMilestone, 'milestone', 'Milestone', () => addMilestone());
  wireAddTileDrag(btnAddMarker, 'marker', 'Date Line', () => addVerticalMarker());
  wireAddTileDrag(btnAddNote, 'note', 'Note', () => {
    const targetId = selItems.size ? [...selItems][0] : null;
    addOrEditNoteForTarget(targetId);
  });

  if (btnAddInline) btnAddInline.addEventListener('click', () => addTask(null));
  if (btnToggleAll) btnToggleAll.addEventListener('click', () => toggleCollapseAll());
  if (btnNotes) btnNotes.addEventListener('click', () => toggleShowNotes());
  if (btnDeps) {
    btnDeps.addEventListener('click', () => {
      showDeps = !showDeps;
      syncDepsVisibility();
    });
  }
  if (btnWeekends) {
    btnWeekends.addEventListener('click', () => {
      if (chartData.showWeekends === false) delete chartData.showWeekends;
      else chartData.showWeekends = false;
      if (!GANTT_ZOOMS[currentZoom()].showWeekends) {
        ui.toast('Weekends show in Day and Week views');
      }
      render();
      if (!presenting()) updateStatus(true);
    });
  }
  if (legendWrap) {
    legendWrap.addEventListener('mouseenter', () => {
      if (!legendOpen) toggleLegendPop(true, false);
    });
    legendWrap.addEventListener('mouseleave', () => {
      if (!legendPinned && legendOpen) toggleLegendPop(false, false);
    });
  }
  if (btnLegend) {
    btnLegend.addEventListener('click', (e) => {
      e.stopPropagation();
      if (legendOpen && legendPinned) toggleLegendPop(false, false);
      else toggleLegendPop(true, true);
    });
  }
  if (btnToday) btnToday.addEventListener('click', () => jumpToToday());
  if (zoomPills) {
    const zoomDock = document.querySelector('.toolbar-zoom');
    if (zoomDock) {
      const sep = zoomDock.querySelector('.dock-sep');
      if (sep) sep.after(zoomPills);
      else zoomDock.appendChild(zoomPills);
    }
    zoomPills.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-zoom-set]');
      if (!btn || !zoomPills.contains(btn)) return;
      const preset = btn.dataset.zoomSet;
      if (preset) setZoomPreset(preset);
    });
  }
  if (treeEl) treeEl.addEventListener('pointerleave', () => setHoveredRow(null));
  if (bodyEl) {
    bodyEl.addEventListener('pointerleave', () => {
      setHoveredRow(null);
      if (!activeDrag) hideGhostBar();
    });
  }

  // Keyboard shortcuts: F2 inline rename, Alt+ArrowUp / Alt+ArrowDown reorder siblings
  window.addEventListener('keydown', (e) => {
    if (presenting() || isTyping()) return;
    if (e.key === 'F2') {
      if (selItems.size === 1) {
        e.preventDefault();
        const id = [...selItems][0];
        const row = els.rows.get(id);
        startInlineRename(id, row ? row.querySelector('.gantt-tree-label') : null);
      } else if (selMarkerId) {
        const m = markerById(selMarkerId);
        const rec = els.markers.get(selMarkerId);
        if (m && rec && rec.flag) {
          e.preventDefault();
          openMarkerRenamePop(rec.flag, m);
        }
      }
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && selItems.size === 1) {
      e.preventDefault();
      moveItemSibling([...selItems][0], e.key === 'ArrowUp' ? -1 : 1);
    }
  });

  // Close popovers / commit note on outside click
  window.addEventListener('pointerdown', (e) => {
    if (floatingPop && !floatingPop.contains(e.target) && (!actionBarEl || !actionBarEl.contains(e.target))) {
      closeFloatingPop();
    }
    if (holidaysPop && !holidaysPop.hidden && !holidaysPop.contains(e.target) && (!btnHolidays || !btnHolidays.contains(e.target))) {
      toggleHolidaysPop(false);
    }
    if (colorKeyHost && !colorKeyHost.hidden && !colorKeyHost.contains(e.target) && (!btnLegend || !btnLegend.contains(e.target))) {
      toggleLegendPop(false, false);
    }
    if (editingNoteId) {
      const card = els.notes.get(editingNoteId);
      if (card && !card.contains(e.target)) {
        const textEl = card.querySelector('.note-text');
        const n = noteById(editingNoteId);
        if (textEl && n) { textEl.blur(); commitNote(n, textEl); }
      }
    }
  }, true);

  function cancelInteraction() {
    let cancelled = false;
    if (connectState) {
      connectState = null;
      if (root) root.classList.remove('is-connecting');
      cancelled = true;
    }
    if (floatingPop) {
      closeFloatingPop();
      cancelled = true;
    }
    if (holidaysPop && !holidaysPop.hidden) {
      toggleHolidaysPop(false);
      cancelled = true;
    }
    if (colorKeyHost && !colorKeyHost.hidden) {
      toggleLegendPop(false);
      cancelled = true;
    }
    return cancelled;
  }

  // --- SEARCH ---
  function searchItems() {
    const out = [];
    const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
    visibleItems().forEach((it) => {
      const el = els.bars.get(it.id) || els.rows.get(it.id);
      const text = clean(it.label || it.id);
      if (el && text) out.push({ id: `item:${it.id}`, text, el });
    });
    (chartData._markers || []).forEach((m) => {
      const rec = els.markers.get(m.id);
      const text = clean(m.label || m.date);
      if (rec && rec.flag && text) out.push({ id: `marker:${m.id}`, text, el: rec.flag });
    });
    notesList().forEach((n) => {
      const card = els.notes.get(n.id);
      const host = card || els.bars.get(n.target) || els.rows.get(n.target);
      const text = clean(n.text);
      if (host && text) out.push({ id: `note:${n.id}`, text, el: host });
    });
    return out;
  }

  function focusSearchItem(item) {
    const el = item && item.el ? item.el : item;
    if (!el || !el.getBoundingClientRect) return;
    const smooth = motion.enabled() ? 'smooth' : 'auto';
    if (timeline && timeline.contains(el)) {
      const tr = timeline.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      const targetLeft = Math.max(0, Math.round(timeline.scrollLeft + (er.left - tr.left) + er.width / 2 - timeline.clientWidth / 2));
      const targetTop = Math.max(0, Math.round(timeline.scrollTop + (er.top - tr.top) + er.height / 2 - timeline.clientHeight / 2));
      timeline.scrollTo({ left: targetLeft, top: targetTop, behavior: smooth });
      return;
    }
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: smooth });
    }
  }

  // Reveal current search match inside #gantt-timeline after shell.js updates .search-current
  function scheduleSearchReveal() {
    requestAnimationFrame(() => {
      const cur = root && root.querySelector('.search-current');
      if (cur) focusSearchItem(cur);
    });
  }
  const searchInputEl = document.getElementById('search-input');
  const searchPrevEl = document.getElementById('search-prev');
  const searchNextEl = document.getElementById('search-next');
  if (searchInputEl) {
    searchInputEl.addEventListener('input', scheduleSearchReveal);
    searchInputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') scheduleSearchReveal(); });
  }
  if (searchPrevEl) searchPrevEl.addEventListener('click', scheduleSearchReveal);
  if (searchNextEl) searchNextEl.addEventListener('click', scheduleSearchReveal);

  // --- STANDALONE SVG EXPORT ---
  function escXml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || (fallback || '');
  }

  function swatchColors(slotOrHex) {
    const slot = colorSlot(slotOrHex || '1');
    const defPal = paletteOf('1') || { slot: '1', hex: cssVar('--primary') };
    const w = paletteOf(slot);
    if (w) {
      return {
        fill: cssVar(`--sw-${w.slot}-fill`, w.hex || defPal.hex),
        border: cssVar(`--sw-${w.slot}-border`, w.hex || defPal.hex),
        text: cssVar(`--sw-${w.slot}-text`, cssVar('--text')),
        solid: w.hex || defPal.hex
      };
    }
    const hex = typeof slotOrHex === 'string' && /^#[0-9a-f]{3,8}$/i.test(slotOrHex) ? slotOrHex : defPal.hex;
    return { fill: hex, border: hex, text: cssVar('--text'), solid: hex };
  }

  function exportSvg() {
    applyLayout();
    const range = chartData._range;
    const vis = visibleItems();
    const rowH = GANTT_METRICS.ROW_H;
    const headerH = GANTT_METRICS.HEADER_H;
    const sideW = sidebarWidth;
    const w = sideW + range.timelineWidth;
    const bodyH = Math.max(1, vis.length) * rowH;
    const h = headerH + bodyH;
    const todayStr = getTodayStr();

    const bg = cssVar('--bg') || 'transparent';
    const surface = cssVar('--surface') || bg;
    const border = cssVar('--border') || 'currentColor';
    const textCol = cssVar('--text') || 'currentColor';
    const muted = cssVar('--muted') || textCol;
    const primary = cssVar('--primary') || textCol;
    const danger = cssVar('--danger') || primary;
    const font = cssVar('--font-sans', 'system-ui, sans-serif');

    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="font-family:${escXml(font)}">`);
    parts.push(`<defs>` +
      `<marker id="exp-arr" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1.5 L 9 5 L 1 8.5 z" fill="${escXml(muted)}"/></marker>` +
      `<marker id="exp-arr-w" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1.5 L 9 5 L 1 8.5 z" fill="${escXml(danger)}"/></marker>` +
      `</defs>`);
    parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="${escXml(bg)}"/>`);

    // Sidebar & header backgrounds
    parts.push(`<rect x="0" y="0" width="${sideW}" height="${h}" fill="${escXml(surface)}"/>`);
    parts.push(`<rect x="0" y="0" width="${w}" height="${headerH}" fill="${escXml(surface)}"/>`);
    parts.push(`<line x1="0" y1="${headerH}" x2="${w}" y2="${headerH}" stroke="${escXml(border)}" stroke-width="1"/>`);
    parts.push(`<line x1="${sideW}" y1="0" x2="${sideW}" y2="${h}" stroke="${escXml(border)}" stroke-width="1"/>`);
    parts.push(`<text x="12" y="${Math.round(headerH / 2 + 4)}" font-size="12" font-weight="600" fill="${escXml(textCol)}">Tasks</text>`);

    // Header ticks (read from rendered DOM if available)
    if (headerTop) {
      headerTop.querySelectorAll('.gantt-tick').forEach((t) => {
        const lx = sideW + (parseFloat(t.style.left) || 0);
        const tw = parseFloat(t.style.width) || 0;
        parts.push(`<line x1="${lx}" y1="0" x2="${lx}" y2="${headerH / 2}" stroke="${escXml(border)}" stroke-width="1"/>`);
        if (tw > 20) {
          parts.push(`<text x="${lx + 6}" y="17" font-size="11" font-weight="600" fill="${escXml(textCol)}">${escXml(t.textContent)}</text>`);
        }
      });
    }
    if (headerBottom) {
      headerBottom.querySelectorAll('.gantt-tick').forEach((t) => {
        const lx = sideW + (parseFloat(t.style.left) || 0);
        const tw = parseFloat(t.style.width) || 0;
        parts.push(`<line x1="${lx}" y1="${headerH / 2}" x2="${lx}" y2="${h}" stroke="${escXml(border)}" stroke-width="1" stroke-opacity="0.55"/>`);
        if (tw > 14) {
          const numEl = t.querySelector('.gantt-day-num');
          const dowEl = t.querySelector('.gantt-day-dow');
          const tickText = (numEl && dowEl) ? `${numEl.textContent} ${dowEl.textContent}` : t.textContent;
          parts.push(`<text x="${lx + 4}" y="${headerH - 8}" font-size="10" fill="${escXml(muted)}">${escXml(tickText)}</text>`);
        }
      });
    }

    // Holidays
    (chartData._holidays || []).forEach((hl) => {
      parts.push(`<rect x="${sideW + hl.x}" y="${headerH}" width="${Math.max(2, hl.w)}" height="${bodyH}" fill="${escXml(danger)}" fill-opacity="0.08"/>`);
    });

    // Rows + sidebar labels + bars
    vis.forEach((it, idx) => {
      const y = headerH + idx * rowH;
      if (idx % 2 === 1) {
        parts.push(`<rect x="${sideW}" y="${y}" width="${range.timelineWidth}" height="${rowH}" fill="${escXml(surface)}" fill-opacity="0.5"/>`);
      }
      parts.push(`<line x1="0" y1="${y + rowH}" x2="${w}" y2="${y + rowH}" stroke="${escXml(border)}" stroke-width="0.5"/>`);
      const padL = 12 + (it._depth || 0) * 16;
      const weight = (it._hasChildren || it.kind === 'group') ? '600' : '400';
      parts.push(`<text x="${padL}" y="${y + Math.round(rowH / 2 + 4)}" font-size="12" font-weight="${weight}" fill="${escXml(textCol)}">${escXml(it.label || it.id)}</text>`);

      if (!it._bar) return;
      const b = it._bar;
      const bx = sideW + b.x;
      const by = headerH + b.y;
      const c = swatchColors(it.color || (it.kind === 'milestone' ? '4' : '1'));

      if (it.kind === 'milestone' && !it._hasChildren) {
        const cx = bx + b.w / 2;
        const cy = by + b.h / 2;
        const r = b.w / 2;
        parts.push(`<polygon points="${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}" fill="${escXml(c.solid)}" stroke="${escXml(c.border)}" stroke-width="1.5"/>`);
        parts.push(`<text x="${bx + b.w + 8}" y="${cy + 4}" font-size="11" font-weight="500" fill="${escXml(textCol)}">${escXml(it.label || it.id)}</text>`);
      } else if (it._hasChildren || it.kind === 'group') {
        parts.push(`<rect x="${bx}" y="${by}" width="${Math.max(4, b.w)}" height="${b.h}" rx="4" fill="${escXml(c.border)}" fill-opacity="0.85"/>`);
      } else {
        parts.push(`<rect x="${bx}" y="${by}" width="${Math.max(4, b.w)}" height="${b.h}" rx="5" fill="${escXml(c.fill)}" stroke="${escXml(c.border)}" stroke-width="1.2"/>`);
      }
    });

    // Dependencies
    parts.push(`<g transform="translate(${sideW}, ${headerH})">`);
    (chartData._deps || []).forEach((dep) => {
      const stroke = dep.violated ? danger : muted;
      const dash = dep.violated ? ' stroke-dasharray="4 3"' : '';
      const mk = dep.violated ? 'url(#exp-arr-w)' : 'url(#exp-arr)';
      parts.push(`<path d="${escXml(dep.path)}" fill="none" stroke="${escXml(stroke)}" stroke-width="1.5"${dash} marker-end="${mk}"/>`);
    });
    parts.push(`</g>`);

    // Vertical markers
    (chartData._markers || []).forEach((m) => {
      const mx = sideW + m.x;
      const c = swatchColors(m.color || '4');
      parts.push(`<line x1="${mx}" y1="${headerH}" x2="${mx}" y2="${h}" stroke="${escXml(c.solid)}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
      parts.push(`<text x="${mx + 4}" y="${headerH - 4}" font-size="10" font-weight="600" fill="${escXml(c.solid)}">${escXml(m.label || m.date)}</text>`);
    });

    // Today line
    if (chartData.showToday !== false && todayStr >= range.start && todayStr <= range.end) {
      const tx = sideW + (ganttDiffDays(range.start, todayStr) + 0.5) * range.pxPerDay;
      parts.push(`<line x1="${tx}" y1="${headerH}" x2="${tx}" y2="${h}" stroke="${escXml(primary)}" stroke-width="2"/>`);
    }

    parts.push(`</svg>`);
    return { svg: parts.join(''), w, h };
  }

  // --- DISK FORMAT (mirrors gantt_to_disk / gantt_from_disk in scripts/disk_format.py) ---
  const GANTT_KEYS = [
    'diagramType', 'schemaVersion', 'title', 'zoom', 'showNotes', 'showToday', 'showWeekends',
    'colorKey', 'holidays', 'markers', 'items', 'dependencies', 'notes'
  ];
  const GENERATED_ID = /^(n|c|e|lane|t|m)_\d{12,}(_\d+)?$/;
  const SLUG_MAX = 30;

  function slug(text) {
    let s = String(text == null ? '' : text).toLowerCase().replace(/đ/g, 'd')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    s = s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (s.length > SLUG_MAX) s = s.slice(0, SLUG_MAX).replace(/_+$/, '');
    return s;
  }

  function renameGanttIds(d) {
    const items = d.items || [];
    const markers = d.markers || [];
    const notes = d.notes || [];
    const used = new Set([...items, ...markers, ...notes]
      .filter((o) => o && typeof o === 'object' && o.id != null)
      .map((o) => o.id));
    const rename = new Map();

    const take = (base) => {
      let id = base;
      let k = 2;
      while (used.has(id)) id = `${base}_${k++}`;
      used.add(id);
      return id;
    };
    const isGen = (o) => GENERATED_ID.test(String(o.id == null ? '' : o.id));

    [[items, 'task'], [markers, 'marker']].forEach(([group, fallback]) => {
      group.forEach((o) => {
        if (o && typeof o === 'object' && isGen(o)) {
          rename.set(o.id, take(slug(o.label) || fallback));
        }
      });
    });

    let count = 1;
    notes.forEach((o) => {
      if (!o || typeof o !== 'object' || !isGen(o)) return;
      while (used.has(`n${count}`)) count++;
      rename.set(o.id, take(`n${count}`));
    });

    if (!rename.size) return;
    const r = (id) => (rename.has(id) ? rename.get(id) : id);
    [...items, ...markers, ...notes].forEach((o) => {
      if (o && typeof o === 'object' && 'id' in o) o.id = r(o.id);
    });
    items.forEach((o) => {
      if (o && typeof o === 'object' && 'parent' in o) o.parent = r(o.parent);
    });
    (d.dependencies || []).forEach((dep) => {
      if (!dep || typeof dep !== 'object') return;
      if ('from' in dep) dep.from = r(dep.from);
      if ('to' in dep) dep.to = r(dep.to);
    });
    notes.forEach((n) => {
      if (n && typeof n === 'object' && 'target' in n) n.target = r(n.target);
    });
  }

  function toDisk(data) {
    const d = JSON.parse(JSON.stringify(data));
    Object.keys(d).forEach((k) => {
      if (k === 'layout' || k === 'canvas' || (k[0] === '_' && k !== '_readme')) delete d[k];
    });
    d.schemaVersion = 1;
    slotColors(d, 'items', 'markers');
    ['items', 'dependencies', 'markers', 'holidays', 'notes'].forEach((listKey) => {
      (d[listKey] || []).forEach((o) => {
        if (!o || typeof o !== 'object') return;
        Object.keys(o).forEach((k) => { if (k[0] === '_') delete o[k]; });
      });
    });
    renameGanttIds(d);
    const out = {};
    GANTT_KEYS.forEach((k) => { if (k in d) out[k] = d[k]; });
    Object.keys(d).forEach((k) => { if (!(k in out)) out[k] = d[k]; });
    return out;
  }

  function fromDisk(data) {
    didInitialScroll = false;
    const d = JSON.parse(JSON.stringify(data));
    delete d.layout;
    slotColors(d, 'items', 'markers');
    return d;
  }

  // --- REGISTER WITH THE SHELL ---
  registerDiagramPlugin({
    id: 'gantt',
    defaultTitle: 'Interactive Gantt Roadmap',
    customViewport: true,
    zoomController,
    contentEl: root || document.getElementById('stage'),
    report: {
      node: '.gantt-bar, .gantt-milestone',
      label: '.gantt-dep-group',
      labelText: '.gantt-dep-label',
      nodeText: '.gantt-ms-label'
    },
    render,
    applyLayout,
    toDisk,
    fromDisk,
    toMermaid,
    fromMermaid,
    exportSvg,
    hasSelection,
    clearSelection,
    deleteSelection,
    cancelInteraction,
    selectAll,
    isBackground: (el) => !el || el === root || el === timeline || el === bodyEl || el === gridEl || (el.classList && el.classList.contains('gantt-row-bg')),
    searchItems,
    getSearchItems: searchItems,
    focusSearchItem
  });
})();
      loadInitialData();
    })();
