// ScanForge adapter for upstream PoissonRecon (MIT and retained BSD source notices).
#include "PreProcessor.h"
#include "Reconstructors.h"
#include <emscripten.h>
#include <memory>
#include <stdexcept>

using namespace PoissonRecon;
namespace {
std::vector<float> vertices, densities;
std::vector<uint32_t> triangles;
std::string lastError;
constexpr size_t MaxVertices=2000000, MaxTriangles=4000000;

struct Samples : Reconstructor::InputOrientedSampleStream<float,3> {
  const float *positions,*normals;size_t count,current=0;
  Samples(const float*p,const float*n,size_t c):positions(p),normals(n),count(c){}
  void reset(){current=0;}
  bool read(Point<float,3>&p,Point<float,3>&n){
    if(current==count)return false;
    for(unsigned a=0;a<3;a++){p[a]=positions[current*3+a];n[a]=normals[current*3+a];}
    current++;return true;
  }
};
struct Vertices : Reconstructor::OutputLevelSetVertexStream<float,3>{
  size_t size()const{return densities.size();}
  size_t write(const Point<float,3>&p,const Point<float,3>&,const float&density){
    if(densities.size()>=MaxVertices)throw std::runtime_error("Poisson output exceeds two million vertices; reduce depth.");
    size_t index=size();for(unsigned a=0;a<3;a++)vertices.push_back(p[a]);densities.push_back(density);return index;
  }
};
struct Faces : Reconstructor::OutputFaceStream<2>{
  size_t size()const{return triangles.size()/3;}
  size_t write(const std::vector<node_index_type>&face){
    if(face.size()!=3)throw std::runtime_error("Poisson extraction returned a non-triangular face.");
    if(size()>=MaxTriangles)throw std::runtime_error("Poisson output exceeds four million triangles; reduce depth.");
    size_t index=size();for(auto v:face)triangles.push_back((uint32_t)v);return index;
  }
};
}
extern "C" {
EMSCRIPTEN_KEEPALIVE void sf_poisson_clear(){std::vector<float>().swap(vertices);std::vector<float>().swap(densities);std::vector<uint32_t>().swap(triangles);lastError.clear();}
EMSCRIPTEN_KEEPALIVE int sf_poisson_reconstruct(const float*p,const float*n,int count,int depth,float weight,float samples){
  sf_poisson_clear();
  try{
    if(count<3||count>500000||depth<6||depth>10||!std::isfinite(weight)||weight<0||weight>100||!std::isfinite(samples)||samples<0.1||samples>100)throw std::runtime_error("Invalid bounded Poisson parameters.");
    for(int i=0;i<count;i++){
      float norm2=0;for(int a=0;a<3;a++){if(!std::isfinite(p[i*3+a])||!std::isfinite(n[i*3+a]))throw std::runtime_error("Poisson coordinates/normals must be finite.");norm2+=n[i*3+a]*n[i*3+a];}
      if(!(norm2>0))throw std::runtime_error("Poisson normals must be nonzero.");
    }
    ThreadPool::ParallelizationType=ThreadPool::NONE;Reconstructor::ProfilerMS=0;
    using Sigs=IsotropicUIntPack<3,FEMDegreeAndBType<2,BOUNDARY_NEUMANN>::Signature>;
    using Solver=Reconstructor::Poisson::Solver<float,3,Sigs>;
    Reconstructor::Poisson::SolutionParameters<float> params;params.depth=depth;params.pointWeight=weight;params.samplesPerNode=samples;params.scale=1.1f;params.confidence=false;
    Samples stream(p,n,count);
    std::unique_ptr<Reconstructor::Implicit<float,3,Sigs>> implicit(Solver::Solve(stream,params));
    if(!implicit)throw std::runtime_error("Poisson solver produced no implicit surface.");
    Reconstructor::LevelSetExtractionParameters extraction;extraction.outputDensity=true;extraction.forceManifold=true;
    Vertices vertexStream;Faces faceStream;implicit->extractLevelSet(vertexStream,faceStream,extraction);
    if(vertices.empty()||triangles.empty())throw std::runtime_error("Poisson reconstruction produced no surface.");
    return 1;
  }catch(const std::bad_alloc&){lastError="Poisson reconstruction exceeded its one GiB WASM heap; reduce depth or point count.";}
  catch(const std::exception&e){lastError=e.what();}
  catch(...){lastError="Poisson reconstruction failed with an unknown native exception.";}
  vertices.clear();densities.clear();triangles.clear();return 0;
}
EMSCRIPTEN_KEEPALIVE int sf_poisson_vertex_count(){return (int)densities.size();}
EMSCRIPTEN_KEEPALIVE int sf_poisson_triangle_count(){return (int)(triangles.size()/3);}
EMSCRIPTEN_KEEPALIVE const float*sf_poisson_vertices(){return vertices.data();}
EMSCRIPTEN_KEEPALIVE const float*sf_poisson_density(){return densities.data();}
EMSCRIPTEN_KEEPALIVE const uint32_t*sf_poisson_triangles(){return triangles.data();}
EMSCRIPTEN_KEEPALIVE const char*sf_poisson_error(){return lastError.c_str();}
}
