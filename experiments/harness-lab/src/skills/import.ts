import { crc32 } from 'node:zlib';
import { fromBuffer, type Entry, type ZipFile } from 'yauzl';
import type { SkillFileInput, SkillImportPreview } from '../contracts/skills.js';
import { RequestError } from '../contracts/errors.js';
import { packageContent, skillLimits, skillPath } from './package.js';
const rejected=(message:string)=>new RequestError('SKILL_IMPORT_INVALID',message);
async function unzip(bytes:Buffer):Promise<SkillFileInput[]> {
  return new Promise((resolve,reject)=>{
    fromBuffer(bytes,{lazyEntries:true,autoClose:true,decodeStrings:true,validateEntrySizes:true,strictFileNames:true},(error,zip:ZipFile|undefined)=>{
      if(error||!zip){reject(rejected('ZIP无法解析。'));return;}
      const files:SkillFileInput[]=[];const paths=new Set<string>();let expanded=0,settled=false,entries=0;
      const fail=(message:string)=>{if(settled)return;settled=true;zip.close();reject(rejected(message));};
      zip.on('error',()=>fail('ZIP损坏或解压失败。'));
      zip.on('entry',(entry:Entry)=>{
        try{
          if(++entries>skillLimits.files*4)throw rejected('ZIP目录项超限。');
          const directory=entry.fileName.endsWith('/'),path=directory?entry.fileName.slice(0,-1):entry.fileName;
          skillPath(path);const normalized=path.toLowerCase();if(paths.has(normalized))throw rejected('ZIP含重复路径。');paths.add(normalized);
          const type=(entry.externalFileAttributes>>>16)&0xf000;
          if(type!==0&&type!==0x8000&&!(type===0x4000&&directory))throw rejected('ZIP不允许链接或特殊文件。');
          if(entry.generalPurposeBitFlag&1)throw rejected('不支持加密ZIP。');
          if(directory){zip.readEntry();return;}
          if(files.length>=skillLimits.files||entry.uncompressedSize>skillLimits.resourceBytes||expanded+entry.uncompressedSize>skillLimits.expandedBytes)throw rejected('ZIP展开内容超过Axon平台限制。');
          zip.openReadStream(entry,(streamError,stream)=>{
            if(streamError||!stream){fail('ZIP内容无法读取。');return;}
            let size=0;const chunks:Buffer[]=[];
            stream.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>skillLimits.resourceBytes||expanded+size>skillLimits.expandedBytes){stream.destroy();fail('ZIP实际展开字节超限。');}else chunks.push(chunk);});
            stream.on('error',()=>fail('ZIP内容损坏。'));
            stream.on('end',()=>{if(settled)return;const bytes=Buffer.concat(chunks);if(crc32(bytes)!==entry.crc32){fail('ZIP文件校验和不匹配。');return;}expanded+=size;files.push({path,contentBase64:bytes.toString('base64')});zip.readEntry();});
          });
        }catch(e){fail(e instanceof Error?e.message:'ZIP无效。');}
      });
      zip.on('end',()=>{if(!settled){settled=true;resolve(files);}});zip.readEntry();
    });
  });
}
export async function previewSkillImport(name:string,bytes:Buffer):Promise<SkillImportPreview> {
  if(!name||name.length>240||bytes.length>skillLimits.archiveBytes)throw rejected('上传超过Axon平台限制。');
  let files:SkillFileInput[];let wrapper:string|undefined;const warnings:string[]=[];
  if(/\.zip$/i.test(name)){
    files=await unzip(bytes);const roots=files.filter(f=>/(^|\/)SKILL\.md$/.test(f.path));
    if(roots.length!==1)throw rejected('ZIP须只包含一个技能根，请拆分技能后上传。');
    const segments=roots[0].path.split('/');
    if(segments.length>2)throw rejected('ZIP包装层级过深，请保留根目录或单层包装。');
    if(segments.length===2){wrapper=segments[0];if(files.some(f=>!f.path.startsWith(wrapper+'/')))throw rejected('ZIP含技能根以外的文件。');files=files.map(f=>({...f,path:f.path.slice(wrapper!.length+1)}));}
  }else if(/\.md$/i.test(name)){
    files=[{path:'SKILL.md',contentBase64:bytes.toString('base64')}];if(name!=='SKILL.md')warnings.push('此Markdown上传适配将文件保存为SKILL.md，正文不变。');
  }else throw rejected('只支持单个Markdown或单技能ZIP上传。');
  const parsed=packageContent(files);
  if(wrapper&&parsed.content.name&&wrapper!==parsed.content.name)parsed.validation.issues.push({code:'ROOT_NAME_MISMATCH',severity:'error',path:'SKILL.md',message:'ZIP技能目录名与name不一致，请修正后重新打包。'});
  parsed.validation.valid=!parsed.validation.issues.some(i=>i.severity==='error');
  return{files,packageDigest:parsed.packageDigest,name:parsed.content.name,description:parsed.content.description,validation:parsed.validation,wrapper,warnings};
}
