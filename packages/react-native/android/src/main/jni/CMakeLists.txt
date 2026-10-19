cmake_minimum_required(VERSION 3.16)
project(scriptca_rn LANGUAGES CXX)
# When building inside an RN app, link libcalculator.a from SCRIPTCA_LIB_DIR
# and expose JNI_OnLoad / JSI install. This stub compiles the host on device ABIs.
add_subdirectory(../../../cpp scriptca_host_build)
