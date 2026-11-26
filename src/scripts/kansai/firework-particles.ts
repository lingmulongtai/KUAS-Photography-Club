export function particles(wide:boolean){
  const positions:number[]=[],directions:number[]=[],stages:number[]=[];
  const shells=wide?5:2,sparks=wide?96:72;
  function vertex(shell:number,kind:number,index:number,tail:number,dx=0,dy=0,dz=0){
    positions.push((shell-(shells-1)/2)*(wide?131:29),wide?25*Math.cos(shell*2.3):0,0);
    directions.push(dx,dy,dz);stages.push(shell,kind,index,tail);
  }
  for(let shell=0;shell<shells;shell++){
    // Ascending mortar trail
    for(let i=0;i<10;i++)vertex(shell,0,i,0);
    // Burst sparks + tails, plus real optical water-plane mirror reflections for every other spark
    for(let i=0;i<sparks;i++){
      const z=1-2*(i+.5)/sparks,angle=i*2.39996323,r=Math.sqrt(1-z*z);
      const dx=Math.cos(angle)*r,dy=Math.sin(angle)*r;
      for(let tail=0;tail<7;tail++)vertex(shell,1,i,tail,dx,dy,z);
      // 3 fine wave-scattered glint copies per reflected spark form an authentic broken water reflection
      if(i%2===0){
        for(let g=0;g<3;g++)vertex(shell,2,i,g,dx,dy,z);
      }
    }
  }
  return {positions,directions,stages};
}

export const simulation=(wide:boolean)=>`
      vec3 palette(float index){
        if(index<1.)return vec3(1.,.65,.24);
        if(index<2.)return vec3(.36,.76,1.);
        if(index<3.)return vec3(1.,.34,.48);
        if(index<4.)return vec3(.53,1.,.78);
        if(index<5.)return vec3(.86,.51,1.);
        return vec3(1.,.85,.57);
      }
      void simulate(out vec3 offset,out float size,out float alpha){
        const bool lake=${wide?'true':'false'};
        const float shells=${wide?'5.':'2.'}, period=${wide?'6.6':'6.'};
        float shell=sparkStage.x,kind=sparkStage.y,i=sparkStage.z,tail=sparkStage.w;
        float clock=u_elapsed+period*shell/shells;
        float wave=floor(clock/period),phase=mod(clock,period);
        bool fan=lake && mod(wave,3.)>1.5 && abs(shell-2.)>.5;
        float lift=fan?.76:1.1;
        float variation=.5+.5*sin(wave*2.43+shell*1.78);
        float apex=fan?46.+variation*26.:(lake?112.:69.)+variation*(lake?97.:43.);
        float radius=(fan?44.:(lake?69.:43.))*(1.+variation*.42);
        float age=phase-lift,life=fan?2.10:2.87;
        vec3 rgb=palette(mod(wave*2.+shell+(lake?1.:0.),6.));
        offset=vec3(0.);
        alpha=0.;size=1.;
        v_water=0.;
        if(kind<.5 && age<0.){
          float t=max(0.,(phase-i*.022)/lift);
          offset.z=apex*(1.-pow(1.-t,1.5));
          rgb=vec3(1.,.82,.53);size=5.-i*.24;alpha=(1.-i/10.)*.9;
        }else if(kind>.5 && age>=0. && age<life){
          bool willow=mod(wave,3.)==1.;
          if(kind<1.5){
            float t=age-tail*(willow?.060:.040);
            float distance=radius*(.91+.09*sin(i*13.4+shell))*(1.-exp(-1.9*max(t,0.)));
            vec3 direction=sparkDirection;if(fan)direction.z=abs(direction.z);
            offset=direction*distance+vec3(2.*t,0.,apex-(willow?9.:5.)*t*t);
            if(t>=0. && offset.z>1.)alpha=pow(1.-age/life,.64)*(1.-tail/8.)*(.89+.11*sin(i+age*8.));
            if(willow && tail>1.)rgb=vec3(1.,.80,.52);
            size=(tail<.5?5.5:4.1)*(1.-.32*age/life);
          }else{
            // Optical mirror reflection of the actual burst spark projected onto the water surface,
            // softly broken up along wave slopes and bounded to the local water body.
            v_water=1.;
            float t=age-tail*.055;
            float distance=radius*(.91+.09*sin(i*13.4+shell))*(1.-exp(-1.9*max(t,0.)));
            vec3 direction=sparkDirection;if(fan)direction.z=abs(direction.z);
            vec3 spark=direction*distance+vec3(2.*t,0.,apex-(willow?9.:5.)*t*t);
            if(t>=0. && spark.z>4.){
              vec2 camXY=viewFromLaunch();
              float camZ=max(8.,cameraHeight());
              float hitT=camZ/(camZ+spark.z);
              vec2 reflXY=camXY+hitT*(spark.xy-camXY);
              vec2 toCam=camXY-reflXY;
              float toCamLen=max(1.,length(toCam));
              vec2 viewDir=toCam/toCamLen;
              vec2 perp=vec2(-viewDir.y,viewDir.x);
              // Gentle organic wave scatter along view ray & across ripples (no neon stripes!)
              float ripplePhase=u_elapsed*3.1+i*4.7+tail*13.3+shell*9.1;
              float scatterAlong=(tail-1.)*(lake?12.:4.5)+sin(ripplePhase)*(lake?5.5:2.2);
              float scatterCross=cos(ripplePhase*1.37+i)*(lake?2.8:1.1);
              reflXY+=viewDir*scatterAlong+perp*scatterCross;
              // Fade smoothly outside the local river/bay water footprint so reflections never spill onto dry land.
              float maxWaterR=lake?260.:46.;
              float inWater=1.-smoothstep(maxWaterR*.65,maxWaterR,length(reflXY));
              // Fresnel-weighted reflection: brighter at low grazing angles, subtle from steep overhead views.
              float grazing=clamp(toCamLen/max(camZ*1.4,1.),.15,1.);
              float shimmer=.55+.45*sin(u_elapsed*5.2+i*11.7+tail*5.3);
              offset=vec3(reflXY.x,reflXY.y,.25);
              if(willow && tail>.5)rgb=vec3(1.,.78,.48);
              rgb*=.78;
              alpha=pow(1.-age/life,.72)*inWater*grazing*shimmer*(tail<.5?.24:.15);
              size=(lake?4.8:3.4)*(1.+.22*tail)*(1.-.28*age/life);
            }
          }
        }
        v_color=vec4(rgb,alpha);
      }
`;
export const pointShape=`
        vec2 p=(gl_PointCoord-.5)*2.;
        // Subtle horizontal wave-glint elongation (1.9x instead of garish 5.5x smeared ovals)
        p.y*=mix(1.,1.95,v_water);
        float d=dot(p,p);if(d>=1.)discard;
        float core=exp(-3.8*d);
        float soft=exp(-2.1*d)*.55;
        float intensity=mix(core,soft,v_water)*(1.-smoothstep(.72,1.,d));
`;
