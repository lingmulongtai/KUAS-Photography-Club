/** Decode the N03 boundary atlas on either map projection. */
export const BOUNDARY_LOOKUP=`
    ivec3 readCell(sampler2D atlas,ivec2 p){
      p.y=textureSize(atlas,0).y-1-p.y;
      return ivec3(round(texelFetch(atlas,p,0).rgb*255.));
    }
    int pointer(ivec3 c){return (c.r-250)*65536+c.b*256+c.g;}
    ivec3 recordAt(int offset){return readCell(islets,ivec2(offset%256,offset/256));}
    int coordinate(int offset){
      ivec3 c=recordAt(offset);
      return c.r+(c.g<<8)+(c.b<<16)-8388608;
    }
    vec2 vertexAt(int offset){return vec2(coordinate(offset),coordinate(offset+1));}
    int islandOwner(int block,vec2 fraction){
      ivec2 pos=ivec2(block%16*16,textureSize(islets,0).y-(block/16+1)*16)+ivec2(fraction*16.);
      ivec3 ids=readCell(islets,pos);
      if(ids.r==0)return ids.g;
      // Signed 24-bit coordinates relative to this 1/2048-degree cell preserve the original shoreline.
      vec2 p=fraction*(4e9/2048.);
      int list=ids.g+(ids.b<<8);
      for(int i=0;i<ids.r;i++){
        ivec3 ref=recordAt(list+i);
        int header=ref.r+(ref.g<<8);
        ivec3 info=recordAt(header);
        int count=info.g,start=header+1;
        vec2 a=vertexAt(start+2*(count-1));
        bool inside=false;
        for(int j=0;j<count;j++){
          vec2 b=vertexAt(start+2*j);
          if((a.y>p.y)!=(b.y>p.y) && p.x-a.x<(b.x-a.x)*((p.y-a.y)/(b.y-a.y)))inside=!inside;
          a=b;
        }
        if(inside)return info.r;
      }
      return 0;
    }
    int prefecture(ivec2 district,vec2 fraction){
      if(any(lessThan(district,ivec2(0))))return 0;
      ivec2 cell=district/32;
      if(any(greaterThanEqual(cell,textureSize(coarse,0))))return 0;
      ivec3 c=readCell(coarse,cell);
      if(c.r<250)return c.r;
      int block=pointer(c);
      c=readCell(districts,ivec2(block%128,block/128)*32+district%32);
      if(c.r==249)return islandOwner(c.g+256*c.b,fraction);
      if(c.r<250)return c.r;
      block=pointer(c);
      ivec2 sub=ivec2(fraction*16.);
      ivec3 bytes=readCell(edges,ivec2(block%256*8,block/256*4)+sub/ivec2(2,4));
      int bits=bytes.r+(bytes.g<<8)+(bytes.b<<16);
      int code=(bits>>(3*((sub.y%4)*2+sub.x%2)))&7;
      return code==0?0:24+code;
    }
`;
