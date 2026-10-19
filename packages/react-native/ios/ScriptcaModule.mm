// React Native ObjC++ TurboModule stub — wires scriptca::Host into RCTBridge.
// Full codegen-integrated TurboModule registration is left to the app template;
// this file documents the native entry points.
#import <Foundation/Foundation.h>
#include "ScriptcaHost.h"

@interface ScriptcaModule : NSObject
@end

@implementation ScriptcaModule {
  scriptca::Host* _host;
}
- (instancetype)init {
  if (self = [super init]) {
    _host = new scriptca::Host();
  }
  return self;
}
- (void)dealloc { delete _host; }
- (NSNumber*)add:(double)a b:(double)b { return @(_host->add(a, b)); }
- (NSString*)greet:(NSString*)name {
  return [NSString stringWithUTF8String:_host->greet(std::string(name.UTF8String)).c_str()];
}
@end
