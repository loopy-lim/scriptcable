cmake_minimum_required(VERSION 3.22)
project(scriptcable_probe)
set(CABLE_ARCHIVE "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../.scriptcable/android-arm64/calculator.lib.a"
    CACHE STRING "scriptc static archive")
add_library(calculator_cable SHARED cable_host.cpp cable_jni.cpp)
add_library(scriptc_core STATIC IMPORTED)
set_target_properties(scriptc_core PROPERTIES IMPORTED_LOCATION "${CABLE_ARCHIVE}")
find_library(log-lib log)
target_link_libraries(calculator_cable PRIVATE scriptc_core ${log-lib})
target_include_directories(calculator_cable PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
target_link_options(calculator_cable PRIVATE
    "-Wl,--version-script=${CMAKE_CURRENT_SOURCE_DIR}/cable-version.map")
