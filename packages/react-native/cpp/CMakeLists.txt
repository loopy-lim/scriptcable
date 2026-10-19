cmake_minimum_required(VERSION 3.16)
project(scriptca_rn_host LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# SCRIPTCA_LIB_DIR: directory with libcalculator.a
if(NOT DEFINED SCRIPTCA_LIB_DIR)
  set(SCRIPTCA_LIB_DIR "${CMAKE_CURRENT_LIST_DIR}/../../../examples/calculator-core/.scriptca")
endif()

add_library(scriptca_host STATIC ScriptcaHost.cpp)
target_include_directories(scriptca_host PUBLIC ${CMAKE_CURRENT_LIST_DIR})
target_link_directories(scriptca_host PUBLIC ${SCRIPTCA_LIB_DIR})
target_link_libraries(scriptca_host PUBLIC calculator m pthread dl)

add_executable(scriptca_host_smoke smoke_main.cpp)
target_link_libraries(scriptca_host_smoke PRIVATE scriptca_host)
