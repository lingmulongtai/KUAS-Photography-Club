import { World } from '../world';
import { Rig, dragLook } from '../rig';
import { apertureText, distanceText } from '../optics';
import { bindSegments, lazyStage, setText, whenReady } from '../ui';
import type { BackdropId } from '../assets';
import type { SubjectId } from '../subjects';

/**
 * Subject and background proposals share one stage: a slowly turning view of a subject
 * in front of a backdrop, with three ready-made shots (wide, standard, telephoto).
 */
document.querySelectorAll<HTMLElement>('[data-gallery]').forEach((root) => {
  const stage = root.querySelector<HTMLElement>('.lab-stage')!;
  const readout = root.querySelector('[data-readout]');
  const subject = root.dataset.subject as SubjectId;
  const backdrop = root.dataset.backdrop as BackdropId;
  lazyStage(stage, (renderer) => {
    const world = new World(renderer, { backdrop, subject, torii: root.dataset.torii === 'true', pinwheel: root.dataset.pinwheel === 'true', leaves: root.dataset.leaves === 'true' });
    const rig = new Rig(renderer, world, { mm: 85, N: 2, autoExpose: true });
    whenReady(stage, world.ready);
    dragLook(stage, rig, { x: 0.9, y: 0.3 });
    let touched = false;
    stage.addEventListener('pointerdown', () => (touched = true));
    bindSegments(root, 'shot', (v) => {
      const [mm, N] = v.split('/').map(Number);
      rig.set({ mm, N });
    });
    bindSegments(root, 'subject', (v) => world.setSubject(v as SubjectId));
    bindSegments(root, 'bg', (v) => world.setBackdrop(v as BackdropId));
    return {
      t0: 2,
      resize: (w, h, dpr) => rig.resize(w, h, dpr),
      render(t, dt) {
        if (!touched) rig.look.x = Math.sin(t * 0.22) * 0.55;
        rig.render(t, dt);
        setText(readout, `${Math.round(rig.now.mm)}mm ${apertureText(rig.now.N)} ・ ${distanceText(rig.subjectDistance())}`);
      },
    };
  });
});
